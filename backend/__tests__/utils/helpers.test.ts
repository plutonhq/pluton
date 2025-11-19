import { generateUID, getNestedValue, setNestedValue } from '../../src/utils/helpers';

describe('helpers', () => {
	describe('generateUID', () => {
		it('should generate a UID of length 12', () => {
			const uid = generateUID();
			expect(uid).toHaveLength(12);
		});

		it('should generate unique UIDs', () => {
			const uids = new Set();
			const iterations = 1000;

			for (let i = 0; i < iterations; i++) {
				uids.add(generateUID());
			}

			// All UIDs should be unique
			expect(uids.size).toBe(iterations);
		});

		it('should only contain lowercase alphanumeric characters', () => {
			const uid = generateUID();
			const validCharacters = /^[0-9a-z]+$/;
			expect(uid).toMatch(validCharacters);
		});

		it('should not contain uppercase letters', () => {
			const uid = generateUID();
			expect(uid).toBe(uid.toLowerCase());
			expect(uid).not.toMatch(/[A-Z]/);
		});

		it('should not contain special characters', () => {
			const uid = generateUID();
			expect(uid).not.toMatch(/[^0-9a-z]/);
		});

		it('should generate different UIDs on consecutive calls', () => {
			const uid1 = generateUID();
			const uid2 = generateUID();
			const uid3 = generateUID();

			expect(uid1).not.toBe(uid2);
			expect(uid2).not.toBe(uid3);
			expect(uid1).not.toBe(uid3);
		});

		it('should use characters from the custom alphabet', () => {
			const uids = Array.from({ length: 100 }, () => generateUID());
			const allChars = uids.join('');
			const uniqueChars = new Set(allChars);

			// Should only contain characters from '1234567890abcdefghijklmnopqrstuvwxyz'
			uniqueChars.forEach(char => {
				expect('1234567890abcdefghijklmnopqrstuvwxyz').toContain(char);
			});
		});
	});

	describe('getNestedValue', () => {
		const testObject = {
			name: 'John',
			age: 30,
			address: {
				street: '123 Main St',
				city: 'New York',
				coordinates: {
					lat: 40.7128,
					lng: -74.006,
				},
			},
			hobbies: ['reading', 'gaming'],
			settings: {
				theme: 'dark',
				notifications: {
					email: true,
					push: false,
				},
			},
		};

		it('should get top-level property', () => {
			expect(getNestedValue(testObject, 'name')).toBe('John');
			expect(getNestedValue(testObject, 'age')).toBe(30);
		});

		it('should get nested property', () => {
			expect(getNestedValue(testObject, 'address.street')).toBe('123 Main St');
			expect(getNestedValue(testObject, 'address.city')).toBe('New York');
		});

		it('should get deeply nested property', () => {
			expect(getNestedValue(testObject, 'address.coordinates.lat')).toBe(40.7128);
			expect(getNestedValue(testObject, 'address.coordinates.lng')).toBe(-74.006);
			expect(getNestedValue(testObject, 'settings.notifications.email')).toBe(true);
		});

		it('should return undefined for non-existent property', () => {
			expect(getNestedValue(testObject, 'nonexistent')).toBeUndefined();
			expect(getNestedValue(testObject, 'address.nonexistent')).toBeUndefined();
			expect(getNestedValue(testObject, 'address.coordinates.nonexistent')).toBeUndefined();
		});

		it('should return undefined when path goes through non-object', () => {
			expect(getNestedValue(testObject, 'name.length.something')).toBeUndefined();
			expect(getNestedValue(testObject, 'age.toString.something')).toBeUndefined();
		});

		it('should handle arrays', () => {
			expect(getNestedValue(testObject, 'hobbies')).toEqual(['reading', 'gaming']);
		});

		it('should handle empty string path', () => {
			expect(getNestedValue(testObject, '')).toBeUndefined();
		});

		it('should handle null or undefined object', () => {
			expect(getNestedValue(null, 'name')).toBeUndefined();
			expect(getNestedValue(undefined, 'name')).toBeUndefined();
		});

		it('should handle boolean values', () => {
			expect(getNestedValue(testObject, 'settings.notifications.push')).toBe(false);
		});

		it('should handle numeric values', () => {
			expect(getNestedValue(testObject, 'address.coordinates.lat')).toBe(40.7128);
		});

		it('should return undefined for partial invalid paths', () => {
			expect(getNestedValue(testObject, 'address.street.invalid')).toBeUndefined();
		});

		it('should handle objects with null values', () => {
			const objWithNull = { key: null };
			expect(getNestedValue(objWithNull, 'key')).toBeNull();
			expect(getNestedValue(objWithNull, 'key.nested')).toBeUndefined();
		});
	});

	describe('setNestedValue', () => {
		it('should set top-level property', () => {
			const obj = { name: 'John' };
			setNestedValue(obj, 'name', 'Jane');
			expect(obj.name).toBe('Jane');
		});

		it('should set nested property', () => {
			const obj = { user: { name: 'John' } };
			setNestedValue(obj, 'user.name', 'Jane');
			expect(obj.user.name).toBe('Jane');
		});

		it('should create intermediate objects if they do not exist', () => {
			const obj: any = {};
			setNestedValue(obj, 'user.profile.name', 'John');
			expect(obj.user.profile.name).toBe('John');
		});

		it('should create deeply nested structure', () => {
			const obj: any = {};
			setNestedValue(obj, 'a.b.c.d.e', 'value');
			expect(obj.a.b.c.d.e).toBe('value');
		});

		it('should overwrite existing values', () => {
			const obj = {
				user: {
					name: 'John',
					age: 30,
				},
			};
			setNestedValue(obj, 'user.name', 'Jane');
			expect(obj.user.name).toBe('Jane');
			expect(obj.user.age).toBe(30); // Other properties should remain unchanged
		});

		it('should handle setting to null', () => {
			const obj: any = { key: 'value' };
			setNestedValue(obj, 'key', null);
			expect(obj.key).toBeNull();
		});

		it('should handle setting to undefined', () => {
			const obj: any = { key: 'value' };
			setNestedValue(obj, 'key', undefined);
			expect(obj.key).toBeUndefined();
		});

		it('should handle setting numbers', () => {
			const obj: any = {};
			setNestedValue(obj, 'count', 42);
			expect(obj.count).toBe(42);
		});

		it('should handle setting booleans', () => {
			const obj: any = {};
			setNestedValue(obj, 'settings.enabled', true);
			expect(obj.settings.enabled).toBe(true);
		});

		it('should handle setting arrays', () => {
			const obj: any = {};
			setNestedValue(obj, 'items', [1, 2, 3]);
			expect(obj.items).toEqual([1, 2, 3]);
		});

		it('should handle setting objects', () => {
			const obj: any = {};
			const value = { foo: 'bar', baz: 42 };
			setNestedValue(obj, 'data', value);
			expect(obj.data).toEqual(value);
		});

		it('should not affect sibling properties', () => {
			const obj = {
				user: {
					name: 'John',
					age: 30,
					email: 'john@example.com',
				},
			};
			setNestedValue(obj, 'user.name', 'Jane');
			expect(obj.user.age).toBe(30);
			expect(obj.user.email).toBe('john@example.com');
		});

		it('should create nested objects without affecting existing structure', () => {
			const obj: any = {
				existing: {
					prop: 'value',
				},
			};
			setNestedValue(obj, 'new.nested.prop', 'new value');
			expect(obj.existing.prop).toBe('value');
			expect(obj.new.nested.prop).toBe('new value');
		});

		it('should handle single key path', () => {
			const obj: any = {};
			setNestedValue(obj, 'key', 'value');
			expect(obj.key).toBe('value');
		});

		it('should handle complex nested updates', () => {
			const obj: any = {
				level1: {
					level2: {
						existingProp: 'exists',
					},
				},
			};
			setNestedValue(obj, 'level1.level2.newProp', 'new');
			expect(obj.level1.level2.existingProp).toBe('exists');
			expect(obj.level1.level2.newProp).toBe('new');
		});

		it('should handle setting values with special characters in path', () => {
			const obj: any = {};
			setNestedValue(obj, 'user.email_address', 'test@example.com');
			expect(obj.user.email_address).toBe('test@example.com');
		});

		it('should maintain object references for unchanged parts', () => {
			const obj: any = {
				unchanged: { ref: 'value' },
			};
			const unchangedRef = obj.unchanged;
			setNestedValue(obj, 'new.prop', 'value');
			expect(obj.unchanged).toBe(unchangedRef);
		});
	});

	describe('integration tests', () => {
		it('should work together - set and get nested values', () => {
			const obj: any = {};
			setNestedValue(obj, 'user.profile.name', 'John Doe');
			setNestedValue(obj, 'user.profile.age', 30);
			setNestedValue(obj, 'user.settings.theme', 'dark');

			expect(getNestedValue(obj, 'user.profile.name')).toBe('John Doe');
			expect(getNestedValue(obj, 'user.profile.age')).toBe(30);
			expect(getNestedValue(obj, 'user.settings.theme')).toBe('dark');
		});

		it('should handle dynamic paths', () => {
			const obj: any = {};
			const basePath = 'config';
			const subPath = 'database';
			const fullPath = `${basePath}.${subPath}.host`;

			setNestedValue(obj, fullPath, 'localhost');
			expect(getNestedValue(obj, fullPath)).toBe('localhost');
		});
	});
});
