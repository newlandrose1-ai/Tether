import { nanoid } from 'nanoid';

export const createId = (size = 12): string => nanoid(size);
