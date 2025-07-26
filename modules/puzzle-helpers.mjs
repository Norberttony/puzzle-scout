
import { Move, Board, Piece, getMoveSAN } from "hyper-chess-board";
import { getEvaluation } from "./engine-helpers.mjs";
import { log } from "./logger.mjs";
import { getMovesFromPV } from "./engine-helpers.mjs";


// takes in a list of blunders (from findBlunders) and returns a list of puzzle candidates,
// which is a list of { fenBeforeMistake, leadingMistake, solution }
export function generatePuzzleCandidates(blunders, winnerMax){
    const candidates = [];

    for (const blunder of blunders){
        // if the horizon effect occurred, where the original mistake is not known
        if (blunder.horizonEffect)
            continue;

        // the blunder should flip the script for the previously winning side, and if it does
        // not, then it is not a good puzzle.
        if (Math.sign(blunder.beforeScore) == Math.sign(blunder.afterScore) && Math.abs(blunder.beforeScore) > winnerMax)
            continue;

        // the blunder should result in a relatively winning position for one of the players...
        if (!blunder.afterScore.isMate && Math.abs(blunder.afterScore.value) < 600)
            continue;

        const candidate = {
            fenBeforeMistake: blunder.fenBeforeBadMove,
            leadingMistake: blunder.badMove,
            solution: blunder.punishPV,
            scoreAfterMistake: blunder.afterScore
        };

        candidates.push(candidate);
    }

    return candidates;
}

export async function verifySolution(candidate, engine, ply, delta){
    const board = new Board();
    board.loadFEN(candidate.fenBeforeMistake);
    board.makeMove(candidate.leadingMistake);

    const lineScore = candidate.scoreAfterMistake;

    // extract PV into move objects
    const candidateSol = getMovesFromPV(board.getFEN(), candidate.solution);

    const solution = [];

    const lastMoves = [];
    
    for (let i = 0; i < candidateSol.length; i += 2){
        const solutionMove = candidateSol[i];
        solutionMove.UCI = solutionMove.uci;

        if (i > 0){
            board.makeMove(candidateSol[i - 1]);
            solution.push(candidateSol[i - 1]);
        }

        solution.push(solutionMove);

        // see if any other moves come up with the same evaluation
        const moves = board.generateMoves(true);

        for (const move of moves){
            if (move.uci == solutionMove.uci)
                continue;

            // analyze this contesting move
            board.makeMove(move);
            engine.write(`position fen ${board.getFEN()}`);
            const think = await getEvaluation(engine, ply, board.turn);
            board.unmakeMove(move);

            if (lineScore.isMate && think.score.isMate){
                if (lineScore.val == think.score.val){
                    // probably a win material line, which only needs to be proven up to a point.
                    if (i > 0){
                        lastMoves.push(move);
                    }else{
                        log(`Rejected candidate because instead of move ${solutionMove.uci} could have played ${move.uci} (mate in ${think.score.value})`);
                        return false;
                    }
                }
            }else if (!lineScore.isMate){
                // lineScore is not a mating value
                const mVal = think.score.value;
                const lVal = lineScore.value;
                if (Math.sign(mVal) == Math.sign(lVal) && (Math.abs(mVal) >= Math.abs(lVal) || Math.abs(mVal - lVal) < delta)){
                    // if it is the last move and there are multiple solutions, be lenient and accept them.
                    if (i > 0){
                        lastMoves.push(move);
                    }else{
                        log(`Rejected candidate because instead of move ${solutionMove.uci} (evaluation is ${lineScore.value}) could have played ${move.uci} (evaluation is ${mVal})`);
                        return false;
                    }
                }
            }
        }

        if (lastMoves.length){
            lastMoves.push(solutionMove);
            break;
        }

        board.makeMove(solutionMove);
    }

    if (lastMoves.length > 0){
        // if there are too many lastMoves, then the user has a lot of options to
        // maintain the winning line, and so the puzzle is over.
        if (lastMoves.length >= 5){
            // remove winner's move added at the end
            solution.pop();
            // remove loser's move added at the end
            solution.pop();
        }else{
            if (solution.length > 0){
                solution[solution.length - 1] = lastMoves;
            }else{
                solution.push(lastMoves);
            }
        }
    }

    return solution;
}

export function formatPuzzle(fen, puzzle, lineScore, stp){
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
    if (lineScore.value == 0)
        title += " and draw";
    else if (lineScore.isMate)
        title += ` Mate in ${(Math.abs(lineScore.value) + 1) / 2}`;
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
