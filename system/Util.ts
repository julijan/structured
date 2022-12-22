// converts string-with-dashes to stringWithDashes
export function toCamelCase(dataKey: string): string {
    let index: number;
    do {
        index = dataKey.indexOf('-');
        if (index > -1) {
            dataKey = dataKey.substring(0, index) + dataKey.substring(index + 1, index + 2).toUpperCase() + dataKey.substring(index + 2);
        }
    } while(index > -1);
    return dataKey;
}

export function randomString(len: number): string {
    let generators = [
        // uppercase letters
        function(): string {
            return String.fromCharCode(65 + Math.floor(Math.random() * 25));
        },
        // lowercase letters
        function(): string {
            return String.fromCharCode(97 + Math.floor(Math.random() * 25));
        },
        // numbers
        function(): string {
            return String.fromCharCode(48 + Math.floor(Math.random() * 10));
        }
    ]

    let str = '';

    while (str.length < len) {
        let generator = generators[Math.floor(Math.random() * generators.length)];
        str += generator();
    }

    return str;
}