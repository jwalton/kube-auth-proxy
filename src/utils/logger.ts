import winston from 'winston';
import debugFormat from 'winston-format-debug';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const logger = winston.createLogger({
    levels: winston.config.syslog.levels,
    level: 'info',
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                debugFormat({
                    levels: winston.config.syslog.levels,
                    colors: winston.config.syslog.colors,
                })
            ),
        }),
    ],
});

export function setLevel(level: LogLevel) {
    logger.level = level;
}

export function debug(message: string) {
    logger.log({ level: 'debug', message });
}

export function info(message: string) {
    logger.log({ level: 'info', message });
}

export function warn(message: string) {
    logger.log({ level: 'warning', message });
}

export function error(err: Error, message?: string) {
    logger.log({ level: 'error', message: message || err.message, err });
}
