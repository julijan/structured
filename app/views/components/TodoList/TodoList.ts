import { ComponentScaffold, LooseObject } from "../../../../system/Types";

export default class TodoList implements ComponentScaffold {

    async getData(): Promise<LooseObject> {
        return {
            tasks: [
                {
                    id: 1,
                    task: 'Make best framework'
                },
                {
                    id: 2,
                    task: 'Then make it better'
                }
            ]
        }
    }

}