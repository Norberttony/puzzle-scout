
import { Board } from "./game/game.mjs";
import { Piece } from "./game/piece.mjs";
import { getEvaluation } from "./engine-helpers.mjs";


// receives an initialFEN string, a list of Move objects, the engine process, and the ply to calculate to.
// this function will use the engine to analyze every position that occurred in the game and return
// a list of evaluations for each position in the form: { score, pv, fenBeforeMove, move, ply, log, color }
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
export function findBlunders(analysis, blunderMag){
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
