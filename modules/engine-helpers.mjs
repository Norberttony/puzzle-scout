
import { Board } from "../game/game.mjs";


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
