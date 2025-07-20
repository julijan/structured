import { PostedDataDecoded } from './request.types.js';

export type ValidationRuleWithArguments = [string, any];

export type FormValidationEntry = {
    // field_name, human readable name
    field: [string, string];
    rules: Array<string | ValidationRuleWithArguments | ValidatorFunction>;
};

export type ValidatorFunction = (data: PostedDataDecoded, field: string, arg: number, rules: Array<string | ValidationRuleWithArguments | ValidatorFunction>) => Promise<boolean>;
export type ValidatorErrorDecorator = (fieldHumanReadable: string, data: PostedDataDecoded, field: string, arg: any) => string | Promise<string>;
export type ValidationErrors = {
    [field: string]: Array<string>;
};

export type ValidationErrorsSingle = {
    [field: string]: string;
};

export type ValidationResult = {
    valid: boolean;
    errors: ValidationErrors | ValidationErrorsSingle;
};