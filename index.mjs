
import fs from "fs";
import { cpus } from "os";

import * as PGN_Handler from "./modules/pgn-file-reader.mjs";
import { Board } from "./game/game.mjs";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { log } from "./modules/logger.mjs";
import { config } from "./modules/config.mjs";
import { TaskManager } from "./modules/task-manager.mjs";


const bar = new ProgressBar("Processing games...");

fs.readFile(config["games-path"], async (err, data) => {
    if (err)
        throw new Error(err);

    log("BEGIN ANALYSIS");

    data = data.toString();
    const gamePGNs = PGN_Handler.splitPGNs(data);

    // try to read from file first.
    const puzzlePotential = fs.existsSync(config["results-path"]) ? JSON.parse(fs.readFileSync(config["results-path"]).toString()) : [];

    const threads = 1; // cpus().length / 2
    const tm = new TaskManager("./modules/puzzle-generator.mjs", threads, { engineDir: "./engine" });

    let gamesProcessed = 0;

    for (const pgn of gamePGNs){
        tm.doTask(pgn)
            .then((puzzles) => {
                gamesProcessed++;
                bar.progress = gamesProcessed / gamePGNs.length;

                puzzlePotential.push(...puzzles);
                fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));

                if (gamesProcessed == gamePGNs.length)
                    tm.terminate();
            });
    }
});


function prepareCmdsFile(){
    let cmds = ``;
    let timeout = 20;
    let p = 0;
    for (const pgn of gamePGNs){
        const board = new Board();

        // extract all move objects to play on the board
        const moveStrings = PGN_Handler.extractMoves(pgn);
        const moves = [];
        for (const m of moveStrings.split(" ")){
            const move = board.getMoveOfSAN(m);
            if (move){
                moves.push(move);
                board.makeMove(move);
                move.san = m;
                timeout--;
                if (timeout == 0){
                    timeout = 10;
                    cmds += `
clear hash
position fen ${board.getFEN()}
go movetime 10000
`;
                    p++;
                }
            }
        }
    }
    console.log(`Gathered ${p} positions`);
    fs.writeFileSync("./cmds.txt", cmds);
}
