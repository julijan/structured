import { ComponentScaffold, LooseObject } from "../../../../system/Types";

export default class Test implements ComponentScaffold {
    async getData(): Promise<LooseObject> {
        return {
            test : 3
        }
    }
}