// converts string-with-dashes to stringWithDashes
export function toCamelCase(dataKey: string, separator: string = '-'): string {
    let index: number;
    do {
        index = dataKey.indexOf(separator);
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

export function unique<T>(arr: Array<T>): Array<T> {
    return arr.reduce((prev, curr) => {
        if (! prev.includes(curr)) {
            prev.push(curr);
        }
        return prev;
    }, [] as Array<T>);
}

export function stripTags(contentWithHTML: string, keepTags: Array<string> = []): string {
    return contentWithHTML.replaceAll(/<\s*\/?\s*[a-zA-Z]+[^>]*?>/g, (sub, index) => {
        const keep = keepTags.some((kept) => {
            const match = new RegExp(`^<\s*\/?\s*${kept}`);
            return match.test(sub);
        });
        if (keep) {
            return sub;
        }
        return sub.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    });
}