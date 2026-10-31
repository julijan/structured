import { EventEmitter } from "../EventEmitter.js";
import { LooseObject, RequestMethod } from "../Types.js";
import { InputDataType } from "../types/client.types.js";
import { attributeValueFromString, mergeDeep, queryStringDecode } from "../Util.js";
import { Net } from "./Net.js";

export class ClientForm extends EventEmitter<{
	beforeSubmit: ClientFormSubmitEvent,
	done: any,
	error: Error,
}> {
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
				try {
					this.submit();
				} catch(e) {
					this.emit('error', e);
				}
			});
		});

		this.emitterReady();
	}

	public async submit<T>(): Promise<T> {
		const event = new ClientFormSubmitEvent(this.getData());
		await this.emit('beforeSubmit', event);
		
		// event was canceled in beforeSubmit callback
		if (event.isCanceled()) {
			throw new Error('submit canceled');
		}
		
		const net = new Net();
		try {
			const res = await net.request(
				this.method,
				this.action,
				{
					'content-type': 'application/json',
				},
				JSON.stringify(event.data),
				this.responseType
			);

			await this.emit('done', res);
			return res as T;
		} catch (e) {
			await this.emit('error', e);
			throw e;
		}
	}

	public getData<T extends LooseObject>(): T {

		const data: LooseObject = {}

		const inputs = this.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select, textarea');

		const setData = (key: string, value: any, type: InputDataType, isArray: boolean) => {

			const toType = (value: any, targetType: InputDataType): any => {
				// leave null as-is
				if (value === null) {
					return null;
				}

				// map array elements to target type
				if (Array.isArray(value)) {
					return value.map((item) => {
						return toType(item, targetType);
					});
				}

				// 1, '1' or 'true' = true
				if (targetType === 'boolean') {
					if (typeof value === 'boolean') {
						return value;
					}

					return value === 1 || value === '1' || value === 'true';
				}

				// parseFloat(value), if isNaN return 0
				if (targetType === 'number') {
					if (typeof value === 'number') {
						return value;
					}

					const int = parseFloat(value);
					if (isNaN(int)) {
						return 0;
					}
	
					return int;
				}

				// no type casting needed
				return value;
			}

			if (isArray) {
				data[key].push(toType(value, type));
			} else {
				data[key] = toType(value, type);
			}
		}

		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];

			let name = input.getAttribute('data-name') || input.getAttribute('name');
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

			if (isArray) {
				// remove [] or [\d+] from name if isArray
				// isArray will make sure values are added to an array
				// but keeping [] in name will wrap the array into an extra array during queryStringDecode
				for (let i = name.length - 1; i > -1; i--) {
					if (name[i] === '[') {
						name = name.substring(0, i);
						break;
					}
				}
			}

			if (isArray && !Array.isArray(data[name])) {
				data[name] = [];
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
						setData(name, null, type, isArray);
						continue;
					}

					for (let i = 0; i < optionsSelected.length; i++) {
						const option = optionsSelected[i] as HTMLOptionElement;
						values.push(option.value);
					}
					setData(name, values, type, isArray);
					continue;
				}

				// single
				if (input.value === '' && nullable) {
					setData(name, null, type, isArray);
					continue;
				}
				
				setData(name, input.value, type, isArray);
				continue;
			}

			if (input.type === 'checkbox') {
				if (type === 'boolean') {
					setData(name, input.checked, type, isArray);
					continue;
				}
				
				if (input.checked) {
					setData(name, input.value, type, isArray);
					continue;
				} else if (nullable) {
					setData(name, null, type, isArray);
					continue;
				}

				continue;
			}

			// radio
			if (input.type === 'radio') {
				if (input.checked) {
					setData(name, input.value, type, isArray);
				}
				continue;
			}

			// handle data-type="any" on input[type="hidden"]
			// value is ignored, instead input is expected to have {{{attr 'value' any}}}
			if (input.type === 'hidden' && type === 'any') {
				if (input.hasAttribute('data-value')) {
					const valueDecoded = attributeValueFromString(input.getAttribute('data-value') ?? '');
					if (typeof valueDecoded === 'string') {
						setData(name, valueDecoded, type, isArray);
					} else {
						setData(name, valueDecoded.value, type, isArray);
					}
					continue;
				}
			}

			// simple inputs
			if (input.value.trim().length === 0 && nullable) {
				setData(name, null, type, isArray);
				continue;
			}

			setData(name, input.value, type, isArray);
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
		}, {} as LooseObject) as T;
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

		if (type === 'any') {
			return 'any';
		}

		return 'string';
	}
}

export class ClientFormSubmitEvent {
	private canceled: boolean = false;
	public data: LooseObject;

	constructor(data: LooseObject) {
		this.data = data;
	}

	public cancel(): void {
		this.canceled = true;
	}

	public isCanceled(): boolean {
		return this.canceled;
	}
}