import simpleGit, { SimpleGit } from "simple-git";
import fs from 'fs';
import path from 'path';
import { config } from "../config";


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
        if (config.git?.authorName) {
            await this.git.addConfig('user.name', config.git.authorName);
        }
        if (config.git?.authorEmail) {
            await this.git.addConfig('user.email', config.git.authorEmail);
        }
    }
}