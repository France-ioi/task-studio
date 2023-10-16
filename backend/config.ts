type Config = {
    port: number,
    folders: {
        base: string,
        repositories: string,
        sessions: string
    },
    git?: {
        allowedRepositories?: string[],
        gitlabUser?: string,
        gitlabPassword?: string,
        githubUser?: string,
        githubPassword?: string,
    }
};

function getConfig() {
    const configJson = require('../config.json');
    return configJson as Config;
}

export const config = getConfig();