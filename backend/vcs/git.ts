import simpleGit, { SimpleGit } from "simple-git";
import fs from 'fs';
import path from 'path';

export class GitRepository {
    public git: SimpleGit;

    constructor(
        public url: string,
        public directory: string
    ) { }

    async init() {
        if (!fs.existsSync(path.join(this.directory, '.git'))) {
            fs.mkdirSync(this.directory, { recursive: true });
            await simpleGit().clone(this.url, this.directory);
        }
        this.git = simpleGit(this.directory, { baseDir: this.directory });
    }
}