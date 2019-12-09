import * as github from './github';
import { AuthModule } from './AuthModule';

const modules: AuthModule[] = [github];
export default modules;
