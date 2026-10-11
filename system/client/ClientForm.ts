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

		const inputs = this.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select, textarea');

		const setData = (key: string, value: any, isArray: boolean) => {
			if (isArray) {
				data[key].push(value);
			} else {
				data[key] = value;
			}
		}

		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];

			const name = input.getAttribute('data-name') || input.getAttribute('name');
			if (name === null) {continue;}

			const type = this.inputDataType(input);
			const nullable = input.hasAttribute('data-nullable');
			const multiple = input.hasAttribute('multiple');
			const isArray = name.endsWith('[]') || /\[\d+\]$/.test(name);

			if (isArray && !Array.isArray(data[name])) {
				data[name] = [];
			}

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
						setData(name, null, isArray);
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
					setData(name, null, isArray);
					continue;
				}
				
				setData(name, type === 'number' ? parseFloat(input.value) : input.value, isArray);
				continue;
			}

			if (input.type === 'checkbox') {
				if (type === 'boolean') {
					setData(name, input.checked, isArray);
					continue;
				}
				
				if (input.checked) {
					const value = type === 'number' ? parseInt(input.value) : input.value;
					setData(name, value, isArray);
					continue;
				} else if (nullable) {
					setData(name, null, isArray);
					continue;
				}

				continue;
			}

			// radio
			if (input.type === 'radio') {
				if (input.checked) {
					if (type === 'boolean') {
						setData(name, input.value === 'true' || input.value === '1', isArray);
					} else if (type === 'number') {
						setData(name, parseFloat(input.value), isArray);
					} else {
						setData(name, input.value, isArray);
					}
				}
				continue;
			}

			// simple inputs
			if (input.value.trim().length === 0 && nullable) {
				setData(name, null, isArray);
				continue;
			}

			if (type === 'number') {
				const int = parseFloat(input.value);
				if (isNaN(int)) {
					if (nullable) {
						setData(name, null, isArray);
						continue;
					}
					
					setData(name, 0, isArray);
					continue;
				}

				setData(name, int, isArray);
				continue;
			}

			setData(name, input.value, isArray);
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