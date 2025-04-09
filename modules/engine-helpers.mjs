
import { Board } from "../game/game.mjs";
import { Piece } from "../game/piece.mjs";
import { Move } from "../game/move.mjs";
import { getMoveSAN } from "../game/san.mjs";


export class Score {
    constructor(value, isMate){
        this.value = value;
        this.isMate = isMate;
    }
}


export function extractFromInfoLine(line, name){
    const idx = line.indexOf(` ${name} `);
    if (idx == -1)
        return;

    const leftSpace = idx + 1 + name.length;
    const rightSpace = line.indexOf(" ", leftSpace + 1);
    return line.substring(leftSpace + 1, rightSpace);
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
                const score = new Score();
                // extract either cp score or mate score.
                let val = parseInt(extractFromInfoLine(line, "score cp"));
                if (isNaN(val)){
                    val = parseInt(extractFromInfoLine(line, "score mate"));
                    score.isMate = true;
                }
                score.value = val;

                return { score, pv: currPV, log: tempLog };
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
        const { score, pv, log } = await getEvaluation(engine, ply);
        analysis.push({ score, pv, fenBeforeMove: initialFEN, ply, log, color: board.turn });
    }

    for (const move of moves){
        let fen = board.getFEN();
        board.makeMove(move);

        if (board.isGameOver())
            break;

        engine.write(`position moves ${move.uci}`);

        const { score, pv, log } = await getEvaluation(engine, ply);
        analysis.push({ score, pv, fenBeforeMove: fen, move, ply, log, color: board.turn });
    }

    return analysis;
}

// analysis returned from analyzeGame with a { score, pv, fenBeforeMove, move, ply, log, color } per position, excluding
// the first position which does not have a move.
// returns a list of { badMove, beforeScore, afterScore, fenBeforeBadMove, expectedPV, punishPV, horizonEffect }
export async function findBlunders(analysis, blunderMag){
    const blunders = [];

    let prevThink = analysis[0];
    for (let i = 1; i < analysis.length; i++){
        const thisThink = analysis[i];
        const blunder = {
            badMove: thisThink.move,
            beforeScore: prevThink.score,
            afterScore: thisThink.score,
            fenBeforeBadMove: thisThink.fenBeforeMove,
            expectedPV: prevThink.pv,
            punishPV: thisThink.pv,
            horizonEffect: false
        };

        if (thisThink.score.isMate && prevThink.score.isMate){
            // user played a move such that it takes longer to force a win
            // in this case, this is noted as a blunder.
            if (thisThink.score.value - prevThink.score.value != 1){
                blunders.push(blunder);
            }
        }else if (prevThink.score.isMate){
            // user missed a mate
            blunders.push(blunder);
        }else if (thisThink.score.isMate){
            if (thisThink.color == Piece.white && thisThink.score.value < 0 || thisThink.color == Piece.black && thisThink.score.value > 0){
                // the horizon effect might have occurred (if white played a move, and only NOW it is a forced mate for white)
                blunder.horizonEffect = true;
                blunders.push(blunder);
            }
        }else{
            const delta = Math.abs(thisThink.score.value - prevThink.score.value);
            if (delta >= blunderMag){
                if (thisThink.color == Piece.white && thisThink.score.value < 0 || thisThink.color == Piece.black && thisThink.score.value > 0){
                    // the horizon effect might have occurred (if white played a move, and only NOW it is winning for white)
                    blunder.horizonEffect = true;
                }
                blunders.push(blunder);
            }
        }
    }
    
    return blunders;
}

// takes in a list of blunders (from findBlunders) and returns a list of puzzle candidates,
// which is a list of { fen, solution }
export async function generatePuzzleCandidates(blunders, winnerMax){
    const candidates = [];

    for (const blunder of blunders){
        // if the horizon effect occurred, where the original mistake is not known
        if (blunder.horizonEffect)
            continue;

        // the blunder should flip the script for the previously winning side, and if it does
        // not, then it is not a good puzzle.
        if (Math.sign(blunder.beforeScore) == Math.sign(blunder.afterScore) && Math.abs(blunder.beforeScore) > winnerMax)
            continue;

        const candidate = {
            fen: blunder.fenBeforeBadMove,
            badMove: blunder.badMove,
            solution: expectedPV
        };

        candidates.push(candidate);
    }

    return candidates;
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
