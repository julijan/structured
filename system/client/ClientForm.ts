import { EventEmitter } from "../EventEmitter.js";
import { LooseObject, RequestMethod } from "../Types.js";
import { InputDataType } from "../types/client.types.js";
import { mergeDeep, queryStringDecode } from "../Util.js";
import { Net } from "./Net.js";

export class ClientForm extends EventEmitter {
	readonly form: HTMLElement;
	readonly name: string;
	readonly action: string;
	readonly method: RequestMethod;
	readonly responseType: XMLHttpRequestResponseType;

	constructor(form: HTMLElement) {
		super();
		this.form = form;
		this.name = this.getName();
		this.action = this.getAction();
		this.method = this.getMethod();
		this.responseType = this.getResponseType();

		this.form.addEventListener('submit', (e) => {
			e.preventDefault();
		});

		const submitButtons = this.form.querySelectorAll('button[type="submit"]');
		submitButtons.forEach((btn) => {
			btn.addEventListener('click', () => {
				this.submit();
			});
		});

		this.emitterReady();
	}

	public async submit<T>(): Promise<T> {
		const data = this.getData();
		await this.emit('beforeSubmit', data);
		const net = new Net();
		try {
			const res = await net.request(
				this.method,
				this.action,
				{
					'content-type': 'application/json',
				},
				JSON.stringify(data),
				this.responseType
			);

			await this.emit('done', res);
			return res as T;
		} catch (e) {
			await this.emit('error', e);
			throw e;
		}
	}

	public getData(): LooseObject {

		const data: LooseObject = {}

		const inputs = this.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');

		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];

			const name = input.getAttribute('name');
			if (name === null) {continue;}

			const type = this.inputDataType(input);
			const nullable = input.hasAttribute('data-nullable');
			const multiple = input.hasAttribute('multiple');
			const isArray = name.endsWith('[]') || /\[\d+\]$/.test(name);

			// file input
			if (type === 'file') {
				console.warn('ClientForm does not support file inputs');
				continue;
			}

			// select
			if (input instanceof HTMLSelectElement) {
				// multiple
				if (multiple) {
					const values: Array<number | string> = [];
					const optionsSelected = Array.from(input.querySelectorAll('option')).filter((opt) => {
						return opt.selected;
					});

					if (nullable && optionsSelected.length === 0) {
						data[name] = null;
						continue;
					}

					for (let i = 0; i < optionsSelected.length; i++) {
						const option = optionsSelected[i] as HTMLOptionElement;
						values.push(type === 'number' ? parseFloat(option.value) : option.value);
					}
					data[name] = values;
					continue;
				}

				// single
				if (input.value === '' && nullable) {
					data[name] = null;
					continue;
				}
				
				data[name] = type === 'number' ? parseFloat(input.value) : input.value;
				continue;
			}

			if (input.type === 'checkbox') {
				if (isArray) {
					if (!Array.isArray(data[name])) {
						data[name] = [];
					}
					if (input.checked) {
						data[name].push(input.value);
						continue;
					}
				} else {
					if (type === 'boolean') {
						data[name] = input.checked;
						continue;
					}

					if (input.checked) {
						data[name] = input.value;
						continue;
					} else if (nullable) {
						data[name] = null;
						continue;
					}
				}

				continue;
			}

			// radio
			if (input.type === 'radio') {
				if (input.checked) {
					if (type === 'boolean') {
						data[name] = input.value === 'true' || input.value === '1';
					} else if (type === 'number') {
						data[name] = parseFloat(input.value);
					} else {
						data[name] = input.value;
					}
				}
				continue;
			}

			// simple inputs
			if (input.value.trim().length === 0 && nullable) {
				data[name] = null;
				continue;
			}

			if (type === 'number') {
				const int = parseFloat(input.value);
				if (isNaN(int)) {
					if (nullable) {
						data[name] = null;
						continue;
					}
					
					data[name] = 0;
					continue;
				}

				data[name] = int;
				continue;
			}

			data[name] = input.value;

		}


		// process data so that nested keys are taken into account
		const setValue = (obj: LooseObject, value: any): LooseObject => {
			const key = Object.keys(obj)[0];
			if (typeof obj[key] === 'object') {
				setValue(obj[key], value);
			} else {
				obj[key] = value;
			}
			return obj;
		}

		return Object.keys(data).reduce((prev, curr) => {
			const objCurr = queryStringDecode(curr);
			setValue(objCurr, data[curr]);
			prev = mergeDeep(prev, objCurr);

			return prev;
		}, {} as LooseObject);
	}

	private getName(): string {
		const name = this.form.getAttribute('data-form');
		if (name === null) {
			throw new Error('Form is missing data-form attribute');
		}
		return name;
	}

	private getAction(): string {
		const action = this.form.getAttribute('action');
		if (action === null) {
			throw new Error('Form missing action attribute');
		}
		return action;
	}

	private getMethod(): RequestMethod {
		const method = this.form.getAttribute('method');
		if (method === null) {
			return 'GET';
		}
		const methodsRecognized: Array<RequestMethod> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

		const methodUppercase = method.toUpperCase() as RequestMethod;

		if (!methodsRecognized.includes(methodUppercase)) {
			throw new Error(`Request method ${method.toUpperCase()} not recognized`);
		}

		return methodUppercase;
	}

	private getResponseType(): XMLHttpRequestResponseType {
		const responseType = (this.form.getAttribute('data-response-type') || '').toLowerCase() as XMLHttpRequestResponseType;

		const recognized: Array<XMLHttpRequestResponseType> = ['text', 'json', 'document', 'arraybuffer', 'blob'];

		if (!recognized.includes(responseType)) {
			return 'json';
		}

		return responseType;
	}

	private inputDataType(input: Element): InputDataType {
		const typeHTML = input.getAttribute('type');
		const typeOverride = input.getAttribute('data-type');
		const type = typeOverride ?? typeHTML ?? null;

		if (type === 'file') {
			return 'file';
		}

		if (type === 'number') {
			return 'number';
		}

		if (type === 'boolean') {
			return 'boolean';
		}

		return 'string';
	}
}