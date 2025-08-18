
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

// retrieves the engine's evaluation of its currently set position in the form
// { score, pv, depth, log }
// where score is an instance of the Score class,
// pv is a string containing the UCI best line-of-play according to the engine
// depth how deeply the engine calculated (in ply)
// and log is the engine's output for this position
// cmd should be either of the form:
// go depth <depth in ply>
// OR
// go movetime <time in ms>
export async function getEvaluation(engine, cmd, stp, timeoutMs){
    const startIdx = engine.log.length;

    await engine.prompt(cmd, "bestmove", timeoutMs);

    // only consider what the engine put into its log after
    const tempLog = engine.log.substring(startIdx);

    const curr = { score: NaN, pv: "", depth: 0, log: "" };

    // go through each of the engine's info lines
    for (const line of tempLog.split("\n")){
        if (line.startsWith("info")){

            // extract PV
            const pvIdx = line.indexOf("pv");
            const pv = line.substring(pvIdx + 3).trim();

            // prioritize depth, and then most recent lines.
            const depth = extractFromInfoLine(line, "depth");
            if (depth && parseInt(depth) >= curr.depth){
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

                // avoid writing in empty PV lines
                if (pv != "")
                    curr.pv = pv;

                curr.score = score;
                curr.depth = depth;
                curr.log = tempLog;
            }
        }
    }

    return curr;
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
