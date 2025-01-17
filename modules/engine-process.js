
const { spawn } = require("child_process");
const { Board } = require("../game/game");
const { Piece } = require("../game/piece");

class EngineProcess {
    constructor(engine, onReadLine = () => 0){
        this.engine = engine;
        this.proc = spawn(this.engine.path);

        this.onReadLine = onReadLine;

        // for prompt
        this.promptPrefix;
        this.onPromptSuccess;
        this.promptTimeout;

        this.log = "";
        this.broken = "";

        this.proc.stdout.on("data", (data) => {
            this.getLines(data.toString());
        });

        this.proc.on("error", (err) => {
            throw new Error(err);
        });
    }

    getLines(stdoutData){
        // stdout data might have multiple lines, and the last line might be cut off.
        const lines = (this.broken + stdoutData).split("\r\n");
        if (!stdoutData.endsWith("\r\n") || lines[lines.length - 1] == "")
            this.broken = lines.pop();

        for (const l of lines){
            this.log += `${l}\n`;
            this.onReadLine(l);
            if (this.promptPrefix && l.startsWith(this.promptPrefix)){
                this.onPromptSuccess(l);
                clearTimeout(this.promptTimeout);
                delete this.promptPrefix;
            }
        }
    }

    prompt(cmd, prefix, timeoutMs = 10000){
        if (this.promptPrefix)
            throw new Error("Cannot prompt a process that is in the process of responding to another prompt.");
        return new Promise((res, rej) => {
            this.promptPrefix = prefix;
            this.onPromptSuccess = (line) => {
                res(line);
            };

            this.promptTimeout = setTimeout(() => {
                console.error(`Prompt ${cmd} failed to achieve prefix ${prefix} after ${timeoutMs}ms`);
                rej();
            }, timeoutMs);

            this.write(cmd);
        });
    }

    // errors if engine is not ready, otherwise succeeds.
    async assertReadiness(){
        await this.prompt("uciready", "uciok");
        await this.prompt("isready", "readyok");
    }

    stop(){
        if (this.proc){
            this.proc.kill();
            delete this.proc;
            delete this.promptPrefix;
            clearTimeout(this.promptTimeout);
        }
    }

    write(cmd){
        if (this.proc){
            const msg = `${cmd}\n`;
            this.log += ` > ${msg}`;
            this.proc.stdin.write(msg);
        }
    }
}

function extractFromInfoLine(line, name){
    const idx = line.indexOf(` ${name} `);
    if (idx == -1)
        return;

    const leftSpace = idx + 1 + name.length;
    const rightSpace = line.indexOf(" ", leftSpace + 1);
    return line.substring(leftSpace + 1, rightSpace);
}

async function getEvaluation(engine, fen, ply){
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
                let eval = parseInt(extractFromInfoLine(line, "score cp"));
                if (isNaN(eval)){
                    const mateScore = parseInt(extractFromInfoLine(line, "score mate"));
                    eval = Math.sign(mateScore) * 99999999 - mateScore;
                }
                return eval;
            }
        }
    }
}

module.exports = { EngineProcess, extractFromInfoLine, getEvaluation };
