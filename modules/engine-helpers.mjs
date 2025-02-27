
import { Board } from "../game/game.mjs";


export function extractFromInfoLine(line, name){
    const idx = line.indexOf(` ${name} `);
    if (idx == -1)
        return;

    const leftSpace = idx + 1 + name.length;
    const rightSpace = line.indexOf(" ", leftSpace + 1);
    return line.substring(leftSpace + 1, rightSpace);
}

export async function getEvaluation(engine, fen, ply){
    const board = new Board();
    board.loadFEN(fen);
    if (board.isGameOver()){
        if (board.result == "/")
            return 0;
        else if (board.result == "#"){
            if (board.turn == Piece.white){
                return -99999999;
            }else{
                return 99999999;
            }
        }
    }

    const startIdx = engine.log.length;

    engine.write(`position fen ${fen}`);
    await engine.prompt(`go depth ${ply}`, "bestmove", 1000000);

    // only consider what the engine put into its log after
    const tempLog = engine.log.substring(startIdx);

    // fetch evaluation of this position based on the shallow depth
    for (const line of tempLog.split("\n")){
        if (line.startsWith("info")){
            const depth = extractFromInfoLine(line, "depth");
            if (depth && parseInt(depth) == ply){
                // extract either cp score or mate score.
                let val = parseInt(extractFromInfoLine(line, "score cp"));
                if (isNaN(val)){
                    const mateScore = parseInt(extractFromInfoLine(line, "score mate"));
                    val = Math.sign(mateScore) * 99999999 - mateScore;
                }
                return val;
            }
        }
    }
}
