import simpleGit, { SimpleGit } from "simple-git";
import fs from 'fs';

export class GitRepository {
    public git: SimpleGit;

    constructor(
        public url: string,
        public path: string
    ) {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path, { recursive: true });
            this.git = simpleGit(path, { baseDir: path, });
            this.git.clone(url, path);
        } else {
            this.git = simpleGit(path, { baseDir: path, });
        }
    }
}