import { exec } from 'child_process';

import { URL } from 'url';
import path from 'path';
import { mkdirSync, existsSync, copyFileSync, unlinkSync } from 'fs';

import { BranchSummary, SimpleGit } from 'simple-git';
import { config } from './config';
import { GitRepository } from './vcs/git';
import md5 from 'md5';
import { Application, Request, Router } from 'express';
import fetch from 'node-fetch';

type ErrorResponse = {
    success: false;
    error: string;
};

function getSessionDir(sessionId: string): string {
    return path.join(config.folders.base, config.folders.sessions, sessionId);
}

function dirCopy(src: string, dest: string): void {
    exec(`cp -R ${src}/* ${dest}`);
}

function getGitRepository(repo: string): GitRepository {
    const repoDir = repo.trim().replace(/\.git$/, '').replace(/[^A-Za-z0-9]/g, '_');
    return new GitRepository(repo, path.join(config.folders.base, config.folders.repositories, repoDir));
}

function getGitBranchForFolder(repo: string, repoDir: string): string {
    return `editor-${md5(repoDir).substr(0, 8)}`; // Implement md5 function here
}

function checkRepositoryAllowed(repo: string): boolean {
    if (!config.git?.allowedRepositories) {
        return true;
    }
    return config.git.allowedRepositories.includes(repo);
}

function setGitUser(repo: string, username?: string, password?: string): string {
    const repoURL = new URL(repo);
    if (username && password) {
        repoURL.username = username;
        repoURL.password = password;
    }
    return repoURL.toString();
}

function isGitlab(repo: string) {
    return repo.includes('//gitlab.com');
}

function setGitBackendUser(repo: string, username?: string, password?: string): string {
    if (isGitlab(repo)) {
        return setGitUser(repo, config.git?.gitlabUser ?? username, config.git?.gitlabPassword ?? password);
    } else {
        return setGitUser(repo, config.git?.githubUser ?? username, config.git?.githubPassword ?? password);
    }
}

async function getGitMainBranch(repo: string): Promise<string> {
    const repoGit = getGitRepository(repo);
    let branches: BranchSummary;
    try {
        branches = await repoGit.git.branch();
    } catch (e) {
        return 'editor';
    }
    if (branches.all.includes('master')) {
        return 'master';
    } else if (branches.all.includes('main')) {
        return 'main';
    }
    return 'editor';
}

async function updateGit(repo: string, subdir: string, username: string, password: string): Promise<{ success: boolean; error?: string; output?: string[] }> {
    const repoGit = getGitRepository(repo);
    const repoBranch = getGitBranchForFolder(repo, subdir);

    try {
        await repoGit.git.fetch();
        await repoGit.git.checkout(await getGitMainBranch(repo));
        await repoGit.git.pull();
        await repoGit.git.branch([repoBranch]).catch(() => { });
        await repoGit.git.checkout(repoBranch);
        await repoGit.git.branch(['--set-upstream-to', `origin/${repoBranch}`, repoBranch]);
        await repoGit.git.pull();
    } catch (e: any) {
        return { success: false, error: e.message };
    }

    // TODO
    //const masterBranch = getGitMainBranch(repo);
    //const historyInfo = getHistory(repo, '');
    /*if($historyInfo['masterAdditional'] > 0 && $historyInfo['editorAdditional'] == 0) {
                exec("cd " . $repoDir . " && git reset --hard $masterBranch");
        }*/

    return { success: true };
}

type PrepareEditionResponse = ErrorResponse | {
    success: boolean;
    session: string;
    token: string;
    masterSynced: boolean;
    editorSynced: boolean;
    masterBranch: string;
    taskEditor: boolean;
};

async function prepareEdition(repo: string, subdir: string): Promise<PrepareEditionResponse> {
    const sessionId = Math.random().toString(36).substring(7); // TODO :: better
    const sessionDir = getSessionDir(sessionId);

    const repoGit = getGitRepository(repo);
    subdir = subdir.trim().replace(/^\//, '').replace(/\/$/, ''); // TODO :: extract as function and reuse later
    const localSubdir = path.join(repoGit.path, subdir);
    mkdirSync(sessionDir, { recursive: true });
    dirCopy(localSubdir, sessionDir);

    // Copy variables.json
    if (existsSync(path.join(repoGit.path, 'variables.json'))) {
        copyFileSync(path.join(repoGit.path, 'variables.json'), path.join(sessionDir, 'variables.json'));
    }

    //const historyInfo = await getHistory(repo, subdir);
    const historyInfo = { success: true, masterAdditional: 0, editorAdditional: 0 };

    return {
        success: true,
        session: sessionId,
        token: 'testtoken',
        masterSynced: ('error' in historyInfo) || historyInfo.masterAdditional === 0,
        editorSynced: ('error' in historyInfo) || historyInfo.editorAdditional === 0,
        masterBranch: await getGitMainBranch(repo),
        taskEditor: existsSync(path.join(localSubdir, 'task_editor.json')),
    };
}

type CommitEditionResponse = { success: boolean; error?: string };

async function commitEdition(repo: string, subdir: string, sessionId: string, commitMsg: string, username: string, password: string): Promise<CommitEditionResponse> {
    if (!checkRepositoryAllowed(repo)) {
        return { success: false, error: 'Repository not allowed' };
    }
    if (!sessionId) {
        return { success: false, error: 'No session ID provided' };
    }
    const sessionDir = getSessionDir(sessionId);

    const repoGit = getGitRepository(repo);
    subdir = subdir.trim().replace(/^\//, '').replace(/\/$/, '');
    const localSubdir = path.join(repoGit.path, subdir) + '/';

    await repoGit.git.checkout(getGitBranchForFolder(repo, subdir));

    // Remove variables.json
    if (existsSync(path.join(sessionDir, 'variables.json'))) {
        unlinkSync(path.join(sessionDir, 'variables.json'));
    }
    dirCopy(sessionDir, localSubdir);

    const repoUrl = setGitBackendUser(repo);

    await repoGit.git.add(['-A']);
    await repoGit.git.commit(commitMsg, undefined, { '--author': 'Editor <task-editor@france-ioi.org>' });
    await repoGit.git.push(repoUrl);

    return { success: true };
}

type HistoryEntry = {
    hash: string;
    date: string;
    message: string;
    master?: boolean;
};

async function getBranchHistory(repo: string, subdir: string, branch: string): Promise<HistoryEntry[]> {
    const logOptions = {
        file: subdir,
        format: {
            hash: '%h',
            date: '%at',
            message: '%s (by %an)',
        },
    };
    logOptions[branch] = null;
    const logs = await getGitRepository(repo).git.log(logOptions);
    return logs.all.map((log) => ({
        hash: log.hash,
        date: log.date,
        message: log.message,
    }));
}

type GetHistoryResponse = {
    success: boolean;
    history: HistoryEntry[];
    historyMaster: HistoryEntry[];
    masterAdditional: number;
    editorAdditional: number;
} | ErrorResponse;

export async function getHistory(repo: string, subdir: string): Promise<GetHistoryResponse> {
    const historyMaster = await getBranchHistory(repo, subdir || '.', await getGitMainBranch(repo));
    const historyEditor = await getBranchHistory(repo, subdir || '.', getGitBranchForFolder(repo, subdir));
    let editorAdditional = 0;
    historyEditor.every((editorLog) => {
        let found = false;
        historyMaster.every((masterLog) => {
            if (masterLog.hash === editorLog.hash) {
                found = true;
                return false;
            }
            return true;
        });
        if (found) {
            editorLog.master = true;
            return false;
        } else {
            editorAdditional += 1;
        }
        return true;
    });
    let masterAdditional = 0;
    historyMaster.every((masterLog) => {
        let found = false;
        historyEditor.every((editorLog) => {
            if (masterLog.hash === editorLog.hash) {
                masterLog.master = true;
                found = true;
                return false;
            }
            return true;
        });
        if (found) {
            return false;
        } else {
            masterAdditional++;
        }
        return true;
    });
    return {
        success: true,
        history: historyEditor,
        historyMaster,
        editorAdditional,
        masterAdditional
    };
}

export async function checkoutHashEdition(repo: string, hash: string) {
    const repoDir = getGitRepository(repo);
    await repoDir.git.checkout(hash);
    return { success: true };
}



export async function getLastCommits(repo: string, subdir: string, username: string, password: string) {
    const repoGit = getGitRepository(repo);

    const masterBranch = await getGitMainBranch(repo);

    await repoGit.git.checkout(masterBranch);
    await repoGit.git.pull();
    const master = (await repoGit.git.log({
        file: subdir || '.',
        format: {
            hash: '%H'
        },
    })).all[0].hash;

    await repoGit.git.checkout(getGitBranchForFolder(repo, subdir));
    const editor = (await repoGit.git.log({
        file: subdir || '.',
        format: {
            hash: '%H'
        },
    })).all[0].hash;

    return { success: !!(master && editor), master, editor };
}

export async function publishEdition(repo: string, subdir: string, type: string, username: string, password: string, title: string, body: string) {
    const repoGit = getGitRepository(repo);
    const masterBranch = await getGitMainBranch(repo);

    await repoGit.git.checkout(masterBranch);
    await repoGit.git.pull();

    await repoGit.git.checkout(getGitBranchForFolder(repo, subdir));

    const branchId = 'publish-' + md5(Math.random().toString()).substr(0, 8);
    await repoGit.git.branch([branchId]);
    await repoGit.git.checkout(branchId);

    if (type === 'prod') {
        // Push directly to production
        await repoGit.git.merge([masterBranch]);
        await repoGit.git.checkout(masterBranch);
        await repoGit.git.merge([branchId]);

        const repoUrl = setGitUser(repo, username, password);

        await repoGit.git.push(repoUrl);
        return { success: true, prod: true };
    } else {
        const repoParse = new URL(repo);
        const repoUrl = setGitBackendUser(repo, username, password);

        await repoGit.git.push([repoUrl]);
        if (type === 'mpr') {
            // Manual PR
            return { success: true, branch: branchId };
        }

        if (repoParse.hostname === 'gitlab.com') {
            const data = {
                title,
                description: body,
                source_branch: branchId,
                target_branch: masterBranch,
            };
            const dataString = JSON.stringify(data);
            const repoId = repoParse.pathname.slice(1).replace('/', '%2F');
            const pw = process.env.GITLAB_PASSWORD || password;
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': dataString.length.toString(),
                },
                body: dataString,
            };
            const response = await fetch(`https://gitlab.com/api/v4/projects/${repoId}/merge_requests?private_token=${pw}`, options);
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            const responseJson = await response.json() as any;
            return { success: true, prUrl: responseJson.web_url };
        } else {
            // Automatic PR
            const data = {
                title,
                body,
                head: branchId,
                base: masterBranch,
            };
            const dataString = JSON.stringify(data);
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': dataString.length.toString(),
                    Authorization: `Bearer ${config.git?.githubPassword || password}`,
                },
                body: dataString,
            };
            const response = await fetch(`https://api.github.com/repos${repoParse.pathname}/pulls`, options);
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            const responseJson = await response.json() as any;
            return { success: true, prUrl: responseJson.html_url };
        }
    }
}

export async function diffEdition(repo: string, subdir: string, hash: string, target: string) {
    const repoGit = getGitRepository(repo);
    const masterBranch = await getGitMainBranch(repo);

    repoGit.git.checkout(masterBranch);
    repoGit.git.pull();
    repoGit.git.checkout(getGitBranchForFolder(repo, subdir));

    if (target === 'master') {
        target = masterBranch;
    } else if (target === 'editor') {
        target = getGitBranchForFolder(repo, subdir);
    }

    const diffResults = await repoGit.git.diff([hash, target, '--', subdir]);
    return { success: true, diff: diffResults };
}



export function registerEditionApi(app: Application) {
    const router = Router();

    function makeErrorFunction(func: (...args: any[]) => Promise<any>) {
        return async (...args: any[]) => {
            try {
                return await func(...args);
            } catch (e: any) {
                return { success: false, error: (e as Error).message };
            }
        }
    }

    function queryToArgs(req: Request): { [key: string]: string } {
        const ARGS = {
            repo: 'gitUrl',
            path: 'gitPath',
            username: 'gitUsername',
            password: 'gitPassword',
            hash: 'hash',
            sessionId: 'session',
            commitMsg: 'commitMsg',
            type: 'type',
            prTitle: 'prTitle',
            prBody: 'prBody',
            target: 'target'
        }
        const args = {};
        for (const key in ARGS) {
            args[key] = req.body[ARGS[key]] || '';
        }
        return args;
    }

    router.use((req, res, next) => {
        res.locals.args = queryToArgs(req);
        if (!checkRepositoryAllowed(res.locals.args.repo)) {
            res.writeHead(403);
            res.end();
            return;
        }
        next();
    });

    router.post('/checkoutEdition', async (req, res) => {
        const { repo, path, username, password } = res.locals.args;
        const result = await makeErrorFunction(updateGit)(repo, path, username, password);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/prepareEdition', async (req, res) => {
        const { repo, path } = res.locals.args;
        const result = await makeErrorFunction(prepareEdition)(repo, path);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/historyEdition', async (req, res) => {
        const { repo, path } = res.locals.args;
        const result = await makeErrorFunction(getHistory)(repo, path);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/checkoutHashEdition', async (req, res) => {
        const { repo, hash } = res.locals.args;
        const result = await makeErrorFunction(checkoutHashEdition)(repo, hash);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/getLastCommits', async (req, res) => {
        const { repo, path, username, password } = res.locals.args;
        const result = await makeErrorFunction(getLastCommits)(repo, path, username, password);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/commitEdition', async (req, res) => {
        const { repo, path, sessionId, commitMsg, username, password } = res.locals.args;
        const result = await makeErrorFunction(commitEdition)(repo, path, sessionId, commitMsg, username, password);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/publishEdition', async (req, res) => {
        const { repo, path, type, username, password, prTitle, prBody } = res.locals.args;
        const result = await makeErrorFunction(publishEdition)(repo, path, type, username, password, prTitle, prBody);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    router.post('/diffEdition', async (req, res) => {
        const { repo, path, hash, target } = res.locals.args;
        const result = await makeErrorFunction(diffEdition)(repo, path, hash, target);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    });

    app.use('/api/edition', router);
}