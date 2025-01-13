
const fs = require("fs");
const { Board } = require("./game/game");
const { getEvaluation } = require("./modules/engine-process");
const { extractEngines } = require("./modules/engine");
const { log } = require("./modules/logger");
const { ProgressBar } = require("./modules/progress-bar");
const { config } = require("./modules/config");

const engineWrapper = extractEngines("./engine")[0];
const bar = new ProgressBar("Verifying puzzles...");
let maxProgress = 0;
let progress = 0;

(async () => {
    log("Beginning verification...");
    
    const puzzles = JSON.parse(fs.readFileSync(config["verify-path"]));
    for (const puzzle of puzzles){
        maxProgress += Math.ceil(puzzle.solution.length / 2);
    }

    let puzzlesProcessed = 0;

    for (const puzzle of puzzles){
        log(`Processing puzzle ${puzzlesProcessed++} with FEN ${puzzle.fen}`);
        const otherSolutions = await verifyPuzzle(puzzle);
        puzzle.otherSolutions = otherSolutions;
        fs.writeFileSync(config["verify-report-path"], JSON.stringify(puzzles));
    }
    log("Complete.");
})();

async function verifyPuzzle(puzzle){
    log("Starting up engine...");

    const engine = engineWrapper.createProcess();
    await engine.assertReadiness();
    engine.write(`position fen ${puzzle.fen}`);

    log("Enigne ready.");

    const board = new Board();
    board.loadFEN(puzzle.fen);

    const otherSolutions = [];

    if (!isVariationValid(puzzle.fen, puzzle.solution)){
        engine.stop();
        const msg = "ERROR: Variation cannot be played out on the board";
        console.error(msg);
        return msg;
    }

    // ensure that the puzzle does not have multiple solutions other than the one provided.
    for (let i = 0; i < puzzle.solution.length; i += 2){
        log(`Analyzing move ${i / 2}: ${puzzle.solution[i]}`);

        const san = typeof(puzzle.solution[i]) == "string" ? puzzle.solution[i] : puzzle.solution[i][0];

        const expectedMove = board.getMoveOfSAN(san);
        otherSolutions[i] = [];

        board.makeMove(expectedMove);
        const evalToBeat = await getEvaluation(engine, board.getFEN(), config["verify-search-ply"]);
        board.unmakeMove(expectedMove);

        log(`An equivalent solution to ${expectedMove.uci} will have an eval of ${evalToBeat}`);

        const moves = board.generateMoves(true);
        log(`Must search through ${moves.length} moves.`);
        let movesProcessed = 0;
        for (const move of moves){
            if (move.uci == expectedMove.uci)
                continue;

            board.makeMove(move);
            const eval = await getEvaluation(engine, board.getFEN(), config["verify-search-ply"]);
            board.unmakeMove(move);

            log(`Evaluated ${move.uci} to be ${eval}`);

            if (Math.sign(eval) == Math.sign(evalToBeat) && (Math.abs(eval - evalToBeat) <= config["verify-mistake-mag"] || Math.abs(eval) > Math.abs(evalToBeat))){
                otherSolutions[i].push({ move: move.uci, eval });
                log("Accepted as alternative solution");
            }

            movesProcessed++;
            bar.progress = (movesProcessed / moves.length + progress) / maxProgress;
        }
        progress++;

        board.makeMove(expectedMove);

        // make opponent's response
        const responseSAN = puzzle.solution[i + 1];
        if (responseSAN){
            const responseMove = board.getMoveOfSAN(responseSAN);
            board.makeMove(responseMove);
            otherSolutions[i + 1] = [];
        }
    }

    engine.stop();

    return otherSolutions;
}

// returns true if the variation can be played out on the board, and false if not.
function isVariationValid(fen, variation){
    const board = new Board();
    board.loadFEN(fen);

    for (const san of variation){
        const move = board.getMoveOfSAN(san);
        if (move){
            board.makeMove(move);
        }else{
            return false;
        }
    }
    return true;
}
