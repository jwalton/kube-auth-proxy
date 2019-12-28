module.exports = {
    coveragePathIgnorePatterns: ['/node_modules/', '/test/'],
    testMatch: ['<rootDir>/test/**/*Test.@(ts|tsx)'],
    transform: {
        '^.+\\.(ts|tsx)$': 'ts-jest',
    },
};
