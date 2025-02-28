
import { Worker } from "worker_threads";


export class TaskManager {
    constructor(workerPath, workersAmt = 1, workerData = {}){
        this.workerPath = workerPath;
        this.workersAmt = workersAmt;
        this.workers = [];
        this.freeWorkers = [];
        this.tasks = [];

        for (let i = 0; i < this.workersAmt; i++){
            const w = new Worker(this.workerPath, { workerData });
            this.workers.push(w);
            this.freeWorkers.push(w);
        }
    }

    doTask(data){
        return new Promise((res, rej) => {
            if (this.freeWorkers.length == 0){
                // queue tasks if no workers can take it
                this.tasks.push({ data, res, rej });
            }else{
                const worker = this.freeWorkers.pop();
                this.#promptWorker(worker, data, res, rej);
            }
        });
    }

    terminate(){
        for (const w of this.workers)
            w.terminate();
    }

    #freeWorker(worker){
        if (this.tasks.length == 0){
            this.freeWorkers.push(worker);
        }else{
            const task = this.tasks.shift();
            this.#promptWorker(worker, task.data, task.res, task.rej);
        }
    }

    #promptWorker(worker, data, res, rej){
        const t = this;
        function message(e){
            worker.off("message", message);
            worker.off("messageerror", error);
            t.#freeWorker(worker);
            res(e);
        }

        function error(e){
            worker.off("message", message);
            worker.off("messageerror", error);
            t.#freeWorker(worker);
            rej(e);
        }

        worker.on("message", message);
        worker.on("messageerror", error);
        worker.postMessage(data);
    }
}
