
import { spawn } from "child_process";


export class EngineProcess {
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

    // errors if engine is not ready, otherwise succeeds.
    async assertReadiness(){
        await this.prompt("uciready", "uciok");
        await this.prompt("isready", "readyok");
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
