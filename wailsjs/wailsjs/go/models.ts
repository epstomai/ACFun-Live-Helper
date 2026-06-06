export namespace main {

	export class SystemStatsResult {
	    cpu: number;
	    memory: number;

	    static createFrom(source: any = {}) {
	        return new SystemStatsResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	    }
	}
	export class TTSVoice {
	    name: string;
	    displayName: string;
	    lang: string;
	    provider: string;

	    static createFrom(source: any = {}) {
	        return new TTSVoice(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.lang = source["lang"];
	        this.provider = source["provider"];
	    }
	}
	export class UpdateInfo {
	    currentVersion: string;
	    latestVersion: string;
	    releaseUrl: string;
	    assetName: string;
	    assetUrl: string;
	    assetSize: number;
	    publishedAt: string;
	    body: string;
	    hasUpdate: boolean;
	    canAutoInstall: boolean;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseUrl = source["releaseUrl"];
	        this.assetName = source["assetName"];
	        this.assetUrl = source["assetUrl"];
	        this.assetSize = source["assetSize"];
	        this.publishedAt = source["publishedAt"];
	        this.body = source["body"];
	        this.hasUpdate = source["hasUpdate"];
	        this.canAutoInstall = source["canAutoInstall"];
	        this.message = source["message"];
	    }
	}
	export class UpdateInstallResult {
	    downloadedPath: string;
	    version: string;
	    message: string;
	    willRestart: boolean;

	    static createFrom(source: any = {}) {
	        return new UpdateInstallResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.downloadedPath = source["downloadedPath"];
	        this.version = source["version"];
	        this.message = source["message"];
	        this.willRestart = source["willRestart"];
	    }
	}

}

