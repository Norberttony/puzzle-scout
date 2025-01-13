
class ProgressBar {
    #progress = 0;

    constructor(title){
        this.title = title;
        this.#logBar();
        ProgressBar.mostRecent = this;
    }

    set progress(value){
        this.#progress = value;

        if (ProgressBar.mostRecent == this){
            process.stdout.write("\r");
            this.#logBar();
        }
    }

    #logBar(){
        const length = 50;
        let str = "[";

        let i = 0;
        for (; i <= Math.floor(this.#progress * length); i++)
            str += "=";

        for (; i < length; i++)
            str += ".";

        str += "]";
        process.stdout.write(str);
    }
}
ProgressBar.mostRecent = undefined;

module.exports = { ProgressBar };
