export type StoreChangeCallback<Key, Val> = (
	key: Key,
	value: Val,
	oldValue: Val | undefined,
	componentId: string
) => void;