import type { Config } from "jest";

const config: Config = {
    testEnvironment: "jsdom",
    setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    maxWorkers: "50%",
    testTimeout: 15000,
    transform: {
        "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
    },
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    testMatch: ["**/*.test.(ts|tsx)"],
};

export default config;
