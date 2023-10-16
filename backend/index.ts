import express from 'express';
import cors from 'cors';
import { config } from './config';
import { registerEditorApi } from './editorApi';
import { registerEditionApi } from './edition';

export function startServer() {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Hello World!');
    });

    registerEditorApi(app);
    registerEditionApi(app);

    app.listen(config.port, () => {
        console.log('Server listening on port ' + config.port);
    });
}

startServer();