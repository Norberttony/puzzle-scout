
import fs from "fs";

import { extractEngines } from "./modules/engine.mjs";
import { getEvaluation } from "./modules/engine-helpers.mjs";
import * as PGN_Handler from "./modules/pgn-file-reader.mjs";
import { Board } from "./game/game.mjs";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { log } from "./modules/logger.mjs";
import { config } from "./modules/config.mjs";


const engineWrapper = extractEngines("./engine")[0];

const shallowPly = config["shallow-search-depth-ply"];
const extraPly = config["confirm-search-additional-ply"];
const blunderMag = config["blunder-magnitude"];
const winnerMax = config["winner-max"];

const bar = new ProgressBar("Processing games...");

fs.readFile(config["games-path"], async (err, data) => {
    if (err)
        throw new Error(err);

    log("BEGIN ANALYSIS");

    data = data.toString();
    const gamePGNs = PGN_Handler.splitPGNs(data);

    const gameCount = gamePGNs.length;
    let gamesProcessed = 0;

    // try to read from file first.
    const puzzlePotential = fs.existsSync(config["results-path"]) ? JSON.parse(fs.readFileSync(config["results-path"]).toString()) : [];

    for (const pgn of gamePGNs){
        log(`Processing game ${gamesProcessed}`);

        log(`Starting engine ${engineWrapper.name}...`);

        let tempLog = "";
        const engine = engineWrapper.createProcess(
            (line) => {
                tempLog += `${line}\n`;
            }
        );

        await engine.prompt("uciready", "uciok");
        await engine.prompt("isready", "readyok");

        log("Engine ready to go.");

        const headers = PGN_Handler.extractHeaders(pgn);
        const board = new Board();
        
        if (headers.FEN)
            board.loadFEN(headers.FEN);

        log("PGN Headers extracted");
        log(`Game identifier is ${headers.Site}`);

        // extract all move objects to play on the board
        const moveStrings = PGN_Handler.extractMoves(pgn);
        const moves = [];
        for (const m of moveStrings.split(" ")){
            const move = board.getMoveOfSAN(m);
            if (move){
                moves.push(move);
                board.makeMove(move);
                move.san = m;
            }
        }

        log(`Total of ${moves.length} moves extracted`);

        for (let i = moves.length - 1; i >= 0; i--)
            board.unmakeMove(moves[i]);

        log("Searching for blunders...");

        // go through game and find blunders.
        tempLog = "";
        let prevVal = await getEvaluation(engine, board.getFEN(), shallowPly);
        let prevFEN = board.getFEN();
        let movesProcessed = 0;
        for (const move of moves){
            board.makeMove(move);

            if (board.isGameOver())
                break;

            const fen = board.getFEN();

            tempLog = "";
            const val = await getEvaluation(engine, fen, shallowPly);
            const diff = Math.abs(val - prevVal);
            const shallowLog = tempLog;
            if (Math.sign(prevVal) == Math.sign(val) && Math.abs(prevVal) > winnerMax){
                // do not count for puzzle potential, this side was already winning.
            }else if (diff >= blunderMag){
                log(`Blunder identified with shallow search at FEN ${fen}. Beginning deep search...`);

                // puzzle potential!!! search even deeper to confirm this
                tempLog = "";
                const deepEval = await getEvaluation(engine, fen, shallowPly + extraPly);
                if (Math.abs(deepEval - prevVal) >= blunderMag){
                    log(`Blunder confirmed with deeper search`);
                    log(`Determining other solutions...`);

                    const deepLog = tempLog;

                    // check if there are multiple moves that allow for a winning position.
                    const testMoves = board.generateMoves(true);
                    let multiAnswer = [];
                    for (const m of testMoves){
                        if (m.uci != move.uci){
                            board.makeMove(m);
                            tempLog = "";
                            const cmpEval = await getEvaluation(engine, board.getFEN(), shallowPly);
                            if (Math.abs(cmpEval - prevVal) >= blunderMag && Math.sign(cmpEval) == Math.sign(deepEval))
                                multiAnswer.push({ move: m.uci, val: cmpEval, log: tempLog });
                            board.unmakeMove(m);
                        }
                    }

                    log(`Found ${multiAnswer.length} solutions.`);

                    if (multiAnswer.length > config["max-solutions"]){
                        log(`Too many valid solutions (max is ${config["max-solutions"]}). Candidate rejected.`);
                    }else{
                        log("Puzzle added.");
                        puzzlePotential.push({ id: gamesProcessed, fen, deepLog, shallowLog, prevVal, prevFEN, mistake: move.uci, otherMoves: multiAnswer });
                        fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));
                    }
                }
            }
            prevVal = val;
            prevFEN = fen;

            const gameProgress = (++movesProcessed / moves.length) * (1 / gameCount);
            bar.progress = gameProgress + gamesProcessed / gameCount;
        }

        gamesProcessed++;
        engine.stop();
    }
    console.log(puzzlePotential);

    fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));
    log(`Finished considering all puzzle candidates. Found ${puzzlePotential.length} candidates.`);
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
