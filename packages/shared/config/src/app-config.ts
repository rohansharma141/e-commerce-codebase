import { Inject } from '@nestjs/common';
import type { Env } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type AppConfig = Readonly<Env>;

export const InjectAppConfig = (): ParameterDecorator => Inject(APP_CONFIG);
