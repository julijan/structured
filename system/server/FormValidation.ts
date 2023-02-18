import { FormValidationEntry, RequestBodyArguments, ValidationErrors, ValidationErrorsSingle, ValidationResult, ValidationRuleWithArguments, ValidatorErrorDecorator, ValidatorFunction } from '../Types';

export class FormValidation {

    fieldRules: Array<FormValidationEntry> = [];

    // if true, only a single error is kept per field
    singleError: boolean = false;

    validators: {
        [name: string] : ValidatorFunction
    } = {
        'required' : async (data, field) => {
            if (! (field in data)) {
                // field missing but required
                return false;
            }

            // field exists, but consider empty strings non valid
            return data[field].trim().length > 0;
        },
        'number' : async (data, field) => {
            // does not need to be a number, but rather contain only numbers
            // eg. 14
            return /^-?\d+$/.test(data[field]);
        },
        'float' : async (data, field) => {
            // 14.2
            return /^-?\d+\.\d+$/.test(data[field]);
        },
        'numeric' : async (data, field, arg, rules) => {
            // 14 or 14.2
            return await this.validators['number'](data, field, arg, rules) || await this.validators['float'](data, field, arg, rules);
        },
        'min' : async(data, field, arg, rules) => {
            if (await this.validators['numeric'](data, field, arg, rules)) {
                return parseFloat(data[field]) >= arg;
            }
            // non numeric value, can't be determined so consider invalid
            return false;
        },
        'max' : async(data, field, arg, rules) => {
            if (await this.validators['numeric'](data, field, arg, rules)) {
                return parseFloat(data[field]) <= arg;
            }
            // non numeric value, can't be determined so consider invalid
            return false;
        },
        'minLength' : async (data, field, arg) => {
            return data[field].length >= arg;
        },
        'maxLength' : async (data, field, arg) => {
            return data[field].length <= arg;
        },
        'alphanumeric' : async (data, field) => {
            // string must contain only letters and numbers
            return /^[a-zA-Z0-9]+$/.test(data[field]);
        },
        'validEmail' : async (data, field) => {
            return /^(?=.{1,254}$)(?=.{1,64}@)[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+(\.[-!#$%&'*+/0-9=?A-Z^_`a-z{|}~]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(data[field]);
        }
    }

    // functions that return error messages
    decorators: {
        [validatorName: string] : ValidatorErrorDecorator
    } = {
        'required' : (fieldHuman) => {
            return `${fieldHuman} is required`;
        },
        'number' : (fieldHuman) => {
            return `${fieldHuman} has to be a whole number`;
        },
        'float' : (fieldHuman) => {
            return `${fieldHuman} has to be a decimal number`;
        },
        'numeric' : (fieldHuman) => {
            return `${fieldHuman} has to contain a numeric value`;
        },
        'min' : (fieldHuman, data, field, arg) => {
            return `${fieldHuman} has to be a value greater than ${arg}`;
        },
        'max' : (fieldHuman, data, field, arg) => {
            return `${fieldHuman} has to be a value lower than ${arg}`;
        },
        'minLength' : (fieldHuman, data, field, arg) => {
            return `${fieldHuman} has to contain at least ${arg} characters`;
        },
        'maxLength' : (fieldHuman, data, field, arg) => {
            return `${fieldHuman} has to contain no more than ${arg} characters`;
        },
        'alphanumeric' : (fieldHuman) => {
            return `${fieldHuman} can contain only letter and numbers`;
        },
        'validEmail' : () => {
            return `Please enter a valid email address`;
        }
    }

    public addRule(fieldName: string, nameHumanReadable: string, rules: Array<string|ValidationRuleWithArguments|ValidatorFunction>): void {
        const rule: FormValidationEntry = {
            field: [fieldName, nameHumanReadable],
            rules
        }
        this.fieldRules.push(rule);
    }

    // register new/override existing validator
    public registerValidator(name: string, validator: ValidatorFunction, decorator?: ValidatorErrorDecorator): void {
        this.validators[name] = validator;

        // if decorator is provided, store it
        if (typeof decorator === 'function') {
            this.decorators[name] = decorator;
        }
    }

    public publicRegisterDecorator(name: string, decorator: ValidatorErrorDecorator): void {
        this.decorators[name] = decorator;
    }

    public async validate(data: RequestBodyArguments): Promise<ValidationResult> {

        const result: ValidationResult = {
            valid: true,
            errors: {}
        }

        // run all validation rules
        for (let i = 0; i < this.fieldRules.length; i++) {
            const entry = this.fieldRules[i];

            const isRequired = entry.rules.includes('required');

            // content - a non required field that is not passed or is blank
            // will pass all checks, for example rules ['numeric']
            // we expect the field to contain a numeric value, but we don't expect the field to exist in the first place
            // se all validators are skipped for content entries
            const isContent = ! isRequired && (! data[entry.field[0]] || data[entry.field[0]].trim().length == 0);

            if (! isContent) {
                for (let j = 0; j < entry.rules.length; j++) {
                    const rule = entry.rules[j];
    
                    if (typeof rule === 'function') {
                        // custom callback (ValidatorFunction)
                        const valid = await rule.apply(this, [data, entry.field[0], 0, entry.rules]);
                        if (! valid) {
                            this.addError(result.errors, data, entry.field, 'callback')
                        }
                    } else {
                        // uses a validator
                        if (typeof rule === 'string') {
                            // no arguments
                            if (this.validators[rule]) {
                                const valid = await this.validators[rule].apply(this, [data, entry.field[0], 0, entry.rules]);
                                if (! valid) {
                                    this.addError(result.errors, data, entry.field, rule);
                                }
                            }
                        } else {
                            // rule with arguments
                            const validatorName = rule[0];
                            const arg = rule[1];
                            if (this.validators[validatorName]) {
                                const valid = await this.validators[validatorName].apply(this, [data, entry.field[0], arg, entry.rules]);
                                if (! valid) {
                                    this.addError(result.errors, data, entry.field, validatorName, arg);
                                }
                            }
                        }
                    }
    
                }
            }

        }

        // valid if no errors
        result.valid = Object.keys(result.errors).length == 0;

        return result;
    }

    private addError(errors: ValidationErrors|ValidationErrorsSingle, data: RequestBodyArguments, field: [string, string], rule: string, arg?: any): void {
        // error will be a human readable error returned by decorator
        // if no decorator is found for the rule, rule itself becomes the error
        let errorMessage = '';
        if (this.decorators[rule]) {
            errorMessage = this.decorators[rule](field[1], data, field[0], arg);
        } else {
            errorMessage = rule;
        }

        if (! this.singleError) {
            if (! errors[field[0]]) {
                errors[field[0]] = [];
            }

            (errors as ValidationErrors)[field[0]].push(errorMessage);
        } else {
            // single error mode
            errors[field[0]] = errorMessage;
        }
    }

}