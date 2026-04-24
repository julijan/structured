export class StructuredError extends Error {

	causedBy: StructuredError | null;
	stack: string | undefined;

	constructor(message: string | Error, cause: StructuredError | Error | null) {
		super(typeof message === 'string' ? message : message.message);
		if (message instanceof Error) {
			this.stack = message.stack;
		}
		if (cause === null) {
			this.causedBy = null;
		} else {
			this.causedBy = cause instanceof StructuredError ? cause : new StructuredError(cause, null);
		}
	}

	public toString(depth: number = 0): string {
		const errorParts: Array<string> = [this.message];

		if (this.stack) {
			errorParts.push('Stack trace:');
			errorParts.push(this.stack);
		}

		if (this.causedBy !== null) {
			errorParts.push('Originated from:');
			errorParts.push(this.causedBy.toString(depth + 1));
		}

		return this.formatLines(errorParts.join('\n'), depth);
	}

	public log(depth: number = 0): void {
		console.error(this.formatLines(this.toString(), depth));
	}

	private formatLines(text: string, depth: number): string {
		const linesFormatted: Array<string> = [];
		const lines = text.split('\n');
		const prepend = '  '.repeat(depth);
		lines.forEach((line) => {
			linesFormatted.push(prepend + line);
		});
		return linesFormatted.join('\n');
	}

}