
import { Board } from "../game/game.mjs";
import { Piece } from "../game/piece.mjs";
import { Move } from "../game/move.mjs";
import { getMoveSAN } from "../game/san.mjs";


export function extractFromInfoLine(line, name){
    const idx = line.indexOf(` ${name} `);
    if (idx == -1)
        return;

    const leftSpace = idx + 1 + name.length;
    const rightSpace = line.indexOf(" ", leftSpace + 1);
    return line.substring(leftSpace + 1, rightSpace);
}

const MAX_SCORE = 99999999;

export function isMate(score){
    return score >= MAX_SCORE - 1000;
}

export function mateIn(score){
    return MAX_SCORE - score;
}

export async function getEvaluation(engine, ply){
    const startIdx = engine.log.length;

    await engine.prompt(`go depth ${ply}`, "bestmove", 1000000);

    // only consider what the engine put into its log after
    const tempLog = engine.log.substring(startIdx);

    // since storing principal variation (PV) in the transposition table (TT) can result in the PV
    // being overwritten before displayed, this code returns the PV of the largest depth.
    let currPV = "";
    let currPVDepth = 0;

    for (const line of tempLog.split("\n")){
        if (line.startsWith("info")){

            // extract PV
            const pvIdx = line.indexOf("pv") + 3;
            const pv = line.substring(pvIdx).trim();
            const pvDepth = pv.split(" ").length + 1;
            if (pvDepth > currPVDepth){
                currPV = pv;
                currPVDepth = pvDepth;
            }

            const depth = extractFromInfoLine(line, "depth");
            if (depth && parseInt(depth) == ply){
                // extract either cp score or mate score.
                let val = parseInt(extractFromInfoLine(line, "score cp"));
                if (isNaN(val)){
                    const mateScore = parseInt(extractFromInfoLine(line, "score mate"));
                    val = Math.sign(mateScore) * MAX_SCORE - mateScore;
                }

                return { val, pv: currPV, log: tempLog };
            }
        }
    }
}

export async function analyzeGame(initialFEN, moves, engine, ply){
    const analysis = [];

    const board = new Board();
    board.loadFEN(initialFEN);
    engine.write(`position fen ${initialFEN}`);
    
    // perform analysis of initial position
    {
        const { val, pv, log } = await getEvaluation(engine, ply);
        analysis.push({ val, pv, fen: initialFEN, ply, log, color: board.turn });
    }

    for (const move of moves){
        let fen = board.getFEN();
        board.makeMove(move);

        if (board.isGameOver())
            break;

        engine.write(`position moves ${move.uci}`);

        const { val, pv, log } = await getEvaluation(engine, ply);
        analysis.push({ val, pv, fen, move, ply, log, color: board.turn });
    }

    return analysis;
}

export async function findBlunders(analysis, engine, blunderMag, ply, winnerMax){
    const blunders = [];

    let prevThink = analysis[0];
    for (let i = 1; i < analysis.length; i++){
        const think = analysis[i];
        const delta = Math.abs(think.val - prevThink.val);

        // the blunder should flip the script for the previously winning side, and if it does
        // not, then it is not a good puzzle.
        if (Math.sign(prevThink.val) == Math.sign(think.val) && Math.abs(prevThink.val) > winnerMax)
            continue;

        // can't take advantage of a blunder that happened before the engine could see it (horizon effect)
        if (think.color == Piece.white && think.val < 0 || think.color == Piece.black && think.val > 0)
            continue;

        if (delta >= blunderMag){
            // now that a possible blunder has been found, it should be confirmed that it is a blunder.
            // if a checkmate has been found, it does not have to be checked.
            if (!isMate(think.val)){
                engine.write(`position fen ${think.fen}`);
                engine.write(`position moves ${think.move.uci}`);
                const deepThink = await getEvaluation(engine, ply);

                // this should still be a blunder...
                if (Math.sign(deepThink.val) != Math.sign(think.val))
                    continue;

                // blunder should be significant
                if (Math.abs(prevThink.val - deepThink.val) < blunderMag)
                    continue;

                deepThink.fen = think.fen;
                deepThink.ply = ply;
                deepThink.move = think.move;
                deepThink.color = think.color;

                // prioritize the longer PV
                deepThink.pv = deepThink.pv.split(" ").length > think.pv.split(" ").length ? deepThink.pv : think.pv;

                blunders.push(deepThink);
            }else{
                blunders.push(think);
            }
        }

        prevThink = think;
    }

    return blunders;
}

export function getMovesFromPV(fen, pv){
    const board = new Board();
    board.loadFEN(fen);

    const moves = [];
    for (const uci of pv.trim().split(" ")){
        const move = board.getMoveOfLAN(uci);
        if (move){
            moves.push(move);
            board.makeMove(move);
        }
    }

    return moves;
}

export async function verifyCandidate(fen, candidate, engine, lineVal, ply, delta){
    const board = new Board();
    board.loadFEN(fen);

    // perform a copy
    candidate = [ ...candidate ];

    const lastMoves = [];
    
    for (let i = 0; i < candidate.length; i += 2){
        const solutionMove = candidate[i];
        solutionMove.UCI = solutionMove.uci;

        if (i > 0)
            board.makeMove(candidate[i - 1]);

        const moves = board.generateMoves(true);

        for (const move of moves){
            if (move.uci == solutionMove.uci)
                continue;

            board.makeMove(move);
            engine.write(`position fen ${board.getFEN()}`);
            const think = await getEvaluation(engine, ply);
            board.unmakeMove(move);

            if (Math.sign(think.val) == Math.sign(lineVal) && (Math.abs(think.val) >= Math.abs(lineVal) || Math.abs(think.val - lineVal) < delta)){
                if (!isMate(lineVal)){
                    // probably a win material line, which only needs to be proven up to a point.
                    if (i > 0){
                        lastMoves.push(move);
                        while (i < candidate.length - 1)
                            candidate.pop();
                    }else{
                        return false;
                    }
                }else{
                    // if it is the last move and there are multiple solutions, be lenient and accept them.
                    if (solutionMove == candidate[candidate.length - 1]){
                        lastMoves.push(solutionMove);
                    }else{
                        return false;
                    }
                }
            }
        }

        if (lastMoves.length)
            break;

        board.makeMove(solutionMove);
    }

    if (lastMoves.length > 0){
        if (candidate.length > 0){
            lastMoves.push(candidate[candidate.length - 1]);
            candidate[candidate.length - 1] = lastMoves;
        }else{
            candidate.push(lastMoves);
        }
    }

    return candidate;
}

export function formatPuzzle(fen, puzzle, lineVal, stp){
    const board = new Board();
    board.loadFEN(fen);

    // convert to SAN
    const solution = [];
    for (const move of puzzle){
        if (move instanceof Move){
            const san = getMoveSAN(board, move);
            solution.push(san);
            board.makeMove(move);
        }
    }

    const lastMoves = puzzle[puzzle.length - 1];
    if (lastMoves && typeof lastMoves != "string" && lastMoves.length > 0){
        const lastSANs = [];
        for (const move of lastMoves){
            const san = getMoveSAN(board, move);
            lastSANs.push(san);
        }
        solution.push(lastSANs);
    }

    // determine title
    let title = stp == Piece.white ? "WTP" : "BTP";
    if (lineVal == 0)
        title += " and draw";
    else if (isMate(lineVal))
        title += ` Mate in ${(mateIn(lineVal) + 1) / 2}`;
    else
        title += " and win material";

    // determine responses
    const responses = [];
    for (let i = 0; i < solution.length; i++)
        responses.push({});

    return {
        fen,
        solution,
        responses,
        title,
        difficulty: "undetermined",
        source: "???"
    }
}
