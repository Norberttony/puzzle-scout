
import fs from "fs";

import { extractEngines } from "./modules/engine.mjs";
import { getEvaluation, analyzeGame, isMate } from "./modules/engine-helpers.mjs";
import * as PGN_Handler from "./modules/pgn-file-reader.mjs";
import { Board } from "./game/game.mjs";
import { ProgressBar } from "./modules/progress-bar.mjs";
import { log } from "./modules/logger.mjs";
import { config } from "./modules/config.mjs";
import { Piece } from "./game/piece.mjs";
import { Move } from "./game/move.mjs";
import { getMoveSAN } from "./game/san.mjs";


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

        log("Analyzing game...");

        const analysis = await analyzeGame(board.getFEN(), moves, engine, shallowPly);

        log("Searching for blunders...");

        // convert the list of analyses of each intermediate position into a list of blunders.
        const blunders = [];
        let prevThink = analysis[0];
        for (let i = 1; i < analysis.length; i++){
            const think = analysis[i];
            const delta = Math.abs(think.val - prevThink.val);

            // the blunder should flip the script for the previously winning side, and if it does
            // not, then it is not a good puzzle.
            if (Math.sign(prevThink.val) == Math.sign(think.val) && Math.abs(prevThink.val) > winnerMax)
                continue;

            // can't take advantage of a blunder that happened before the engine could see it (horizon effect)
            if (think.color == Piece.white && think.val < 0 || think.color == Piece.black && think.val > 0)
                continue;

            if (delta >= blunderMag){
                // now that a possible blunder has been found, it should be confirmed that it is a blunder.
                // if a checkmate has been found, it does not have to be checked.
                if (!isMate(think.val)){
                    engine.write(`position fen ${think.fen}`);
                    engine.write(`position moves ${think.move.uci}`);
                    const deepThink = await getEvaluation(engine, shallowPly + extraPly);

                    // this should still be a blunder...
                    if (Math.sign(deepThink.val) != Math.sign(think.val))
                        continue;

                    // blunder should be significant
                    if (Math.abs(prevThink.val - deepThink.val) < blunderMag)
                        continue;

                    deepThink.fen = think.fen;
                    deepThink.ply = shallowPly + extraPly;
                    deepThink.move = think.move;
                    deepThink.color = think.color;

                    // prioritize the longer PV
                    deepThink.pv = deepThink.pv.split(" ").length > think.pv.split(" ").length ? deepThink.pv : think.pv;

                    blunders.push(deepThink);
                }else{
                    blunders.push(think);
                }
            }

            prevThink = think;
        }

        log(`${blunders.length} blunders have been found. Beginning verification phase...`);

        // convert a list of blunders into a list of potential puzzles.
        const puzzles = [];
        for (const blunder of blunders){
            board.loadFEN(blunder.fen);
            board.makeMove(blunder.move);

            log(`Looking at puzzle: ${blunder.val} ${blunder.pv}`);

            // extract PV into actual move objects
            const puzzle = [];
            for (const uci of blunder.pv.split(" ")){
                const move = board.getMoveOfLAN(uci);
                if (move){
                    puzzle.push(move);
                    board.makeMove(move);
                }
            }
            
            board.loadFEN(blunder.fen);
            board.makeMove(blunder.move);

            const lastMoves = [];

            let isGood = true;
            for (let i = 0; i < puzzle.length; i += 2){
                const solutionMove = puzzle[i];
                solutionMove.UCI = solutionMove.uci;

                if (i > 0)
                    board.makeMove(puzzle[i - 1]);

                log(board.getFEN());
                const moves = board.generateMoves(true);

                for (const move of moves){
                    if (i == 0)
                        break;
                    if (move.uci == solutionMove.uci)
                        continue;

                    board.makeMove(move);
                    engine.write(`position fen ${board.getFEN()}`);
                    const think = await getEvaluation(engine, config["verify-search-ply"]);
                    board.unmakeMove(move);

                    log(`Try maybe ${think.val} ${move.uci} instead of ${blunder.val} ${solutionMove.uci}?`);

                    if (Math.sign(think.val) == Math.sign(blunder.val) && (Math.abs(think.val) >= Math.abs(blunder.val) || Math.abs(think.val - blunder.val) < config["verify-delta"])){
                        log(`Instead of ${blunder.val} ${solutionMove.uci}, could play ${think.val} ${move.uci}`);
                        if (!isMate(blunder.val)){
                            // probably a win material line, which only needs to be proven up to a point.
                            if (i > 0){
                                lastMoves.push(move);
                                while (i < puzzle.length - 1)
                                    puzzle.pop();
                                console.log(puzzle);
                            }else{
                                isGood = false;
                                break;
                            }
                        }else{
                            // if it is the last move and there are multiple solutions, be lenient and accept them.
                            if (solutionMove == puzzle[puzzle.length - 1]){
                                lastMoves.push(solutionMove);
                            }else{
                                isGood = false;
                                break;
                            }
                        }
                    }
                }

                board.makeMove(solutionMove);

                if (!isGood || lastMoves.length)
                    break;
            }

            console.log("PUZZLE STUFF", puzzle, lastMoves);

            if (!isGood)
                continue;

            if (lastMoves.length > 0){
                lastMoves.push(puzzle[puzzle.length - 1]);
                puzzle[puzzle.length - 1] = lastMoves;
            }

            // convert to SAN
            const solution = [];
            board.loadFEN(blunder.fen);
            board.makeMove(blunder.move);
            const afterBlunderFEN = board.getFEN();
            for (const move of puzzle){
                if (move instanceof Move){
                    const san = getMoveSAN(board, move);
                    solution.push(san);
                    board.makeMove(move);
                }
            }
            if (lastMoves.length > 0){
                const lastSANs = [];
                for (const move of lastMoves){
                    const san = getMoveSAN(board, move);
                    lastSANs.push(san);
                }
                solution.push(lastSANs);
            }

            let title = blunder.color == Piece.white ? "WTP" : "BTP";
            if (blunder.val == 0)
                title += " and draw";
            else if (isMate(blunder.val))
                title += ` Mate in ${(mateIn(blunder.val) + 1) / 2}`;
            else
                title += " and win material";

            const responses = [];
            for (let i = 0; i < solution.length; i++)
                responses.push({});

            puzzles.push({
                fen: afterBlunderFEN,
                beforeBlunder: blunder.fen,
                solution,
                responses,
                title,
                difficulty: "undetermined",
                source: "???"
            });
        }

        log(`Generated ${puzzles.length} additional puzzles`);

        puzzlePotential.push(...puzzles);
        fs.writeFileSync(config["results-path"], JSON.stringify(puzzlePotential));

        gamesProcessed++;
        engine.stop();
    }

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
