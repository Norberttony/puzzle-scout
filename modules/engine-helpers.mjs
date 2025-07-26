
import { Board, Piece } from "hyper-chess-board";


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

export async function getEvaluation(engine, ply, stp){
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
            const pvIdx = line.indexOf("pv");
            const pv = line.substring(pvIdx + 3).trim();
            const pvDepth = pv.split(" ").length + (pv.length > 0 ? 1 : 0);
            if (pvIdx > -1 && pvDepth > currPVDepth){
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
                if (stp == Piece.black)
                    val = -val;
                score.value = val;

                return { score, pv: currPV, log: tempLog };
            }
        }
    }
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
