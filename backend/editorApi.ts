import { Application, Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config';

function isFileExcludedFromSync(file: string) {
    // TODO
    return false;
}

function mime_content_type(file: string) {
    // TODO
    return 'application/octet-stream';
}

function checkToken(token: string, sessionId: string) {
    // TODO
    return (token == 'testtoken');
}

function getSessionDir(sessionId: string) {
    return path.join(config.folders.base, config.folders.sessions, sessionId);
}

function getSessionFilePath(sessionId: string, filePath: string) {
    const sessionDir = getSessionDir(sessionId);
    const file = path.resolve(path.join(sessionDir, filePath));
    if (!file.startsWith(sessionDir)) {
        throw new Error('Forbidden');
    }
    return file;
}

function recursiveDirList(dirPath: string, prefix: string) {
    let list = [];
    fs.readdirSync(dirPath).forEach(file => {
        if (isFileExcludedFromSync(file)) {
            return;
        }
        const subpath = path.join(dirPath, file);
        if (fs.statSync(subpath).isDirectory()) {
            list = list.concat(recursiveDirList(subpath, path.join(prefix, file)));
        } else {
            list.push(path.join(prefix, file).replace(/^\//, ''));
        }
    });
    return list;
}

function getList(sessionId: string) {
    return recursiveDirList(getSessionDir(sessionId), '');
}

function getFile(sessionId: string, filePath: string, res: Response) {
    const file = getSessionFilePath(sessionId, filePath);
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
    }
    res.setHeader('Content-Type', mime_content_type(file));
    fs.createReadStream(file).pipe(res);
}

function putFile(sessionId: string, filePath: string, start: number, truncate: boolean, req: Request, res: Response) {
    const file = getSessionFilePath(sessionId, filePath);

    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(file)) {
        truncate = true;
    }
    const stream = fs.createWriteStream(file, { flags: truncate ? 'w+' : 'r+', start });
    req.pipe(stream);
    req.on('end', () => {
        res.end();
    });
}

function deleteFile(sessionId: string, filePath: string, res: Response) {
    const file = getSessionFilePath(sessionId, filePath);
    if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
    }
    fs.unlinkSync(file);
    res.end();
}

export function registerEditorApi(app: Application) {
    const router = Router();

    router.use((req, res, next) => {
        // if(!req.headers.authorization) {
        //     res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
        //     res.end();
        //     return;
        // }

        // const authorization = req.headers.authorization;
        // if(!authorization.startsWith('Bearer ')) {
        //     res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
        //     res.end();
        //     return;
        // }
        // const token = authorization.substring(7);
        const token = 'testtoken';

        const uriSplit = req.url.split('/', 4);
        const sessionId = uriSplit[1];

        if (!checkToken(token, sessionId)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
            res.end();
            return;
        }
        next();
    });

    router.get('/:sessionId/list', (req, res) => {
        const list = getList(req.params.sessionId);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(list));
        return;
    });

    router.route('/:sessionId/file/*')
        .get((req, res) => {
            getFile(req.params.sessionId, req.params[0], res);
        })
        .put((req, res) => {
            const start = parseInt(req.query.start as string) || 0;
            const truncate = parseInt(req.query.truncate as string) || 0;
            if (truncate === 1 && start !== 0) {
                res.writeHead(400);
                res.end();
                return;
            }
            putFile(req.params.sessionId, req.params[0], start, truncate === 1, req, res);
        })
        .delete((req, res) => {
            deleteFile(req.params.sessionId, req.params[0], res);
        })
        .options((_req, res) => {
            res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
            res.end();
        });

    router.use((_req, res) => {
        res.writeHead(404);
        res.end();
    });

    app.use('/edition', router);
}

