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

}

