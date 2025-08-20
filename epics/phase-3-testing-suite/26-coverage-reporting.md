# User Story: Add Test Coverage Reporting

## Story
As a team lead, I want comprehensive test coverage reporting so that we can identify untested code paths and maintain high quality standards.

## Acceptance Criteria
- [ ] Coverage reports are generated after test runs
- [ ] HTML reports are viewable locally
- [ ] Coverage thresholds are enforced
- [ ] CI/CD integration is configured
- [ ] Uncovered lines are highlighted

## Technical Details
Update package.json scripts:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "coverage:report": "vitest run --coverage && open coverage/index.html"
  }
}
```

Create test/coverage.config.ts:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      
      // Coverage thresholds
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        perFile: true
      },
      
      // Files to include
      include: [
        'src/**/*.ts',
        'netlify/functions/**/*.ts'
      ],
      
      // Files to exclude
      exclude: [
        'node_modules',
        'test',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/*.d.ts',
        '**/index.ts',
        'dist',
        '.netlify'
      ],
      
      // Watermarks for HTML report
      watermarks: {
        lines: [80, 95],
        functions: [80, 95],
        branches: [80, 95],
        statements: [80, 95]
      },
      
      // Options
      all: true, // Include files with no tests
      clean: true, // Clean coverage before running
      skipFull: false // Don't skip files with 100% coverage
    }
  }
});
```

Create .github/workflows/coverage.yml:
```yaml
name: Test Coverage

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  coverage:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npm run test:coverage
        env:
          API_KEY: ${{ secrets.TEST_API_KEY }}
          JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella
          fail_ci_if_error: true
      
      - name: Generate coverage badge
        uses: jaywcjlove/coverage-badges-cli@main
        with:
          source: coverage/coverage-summary.json
          output: coverage/badges.svg
      
      - name: Comment PR with coverage
        if: github.event_name == 'pull_request'
        uses: romeovs/lcov-reporter-action@v0.3.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          lcov-file: ./coverage/lcov.info
          
      - name: Check coverage thresholds
        run: |
          npx nyc check-coverage \
            --lines 80 \
            --functions 80 \
            --branches 80 \
            --statements 80
```

Create test/coverage-report.ts:
```typescript
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface CoverageSummary {
  total: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
}

function generateCoverageReport() {
  const coveragePath = join(process.cwd(), 'coverage', 'coverage-summary.json');
  const coverage: CoverageSummary = JSON.parse(
    readFileSync(coveragePath, 'utf-8')
  );
  
  const report = `
# Test Coverage Report

Generated: ${new Date().toISOString()}

## Summary
- **Lines**: ${coverage.total.lines.pct}%
- **Statements**: ${coverage.total.statements.pct}%
- **Functions**: ${coverage.total.functions.pct}%
- **Branches**: ${coverage.total.branches.pct}%

## Status
${getCoverageStatus(coverage)}

## Uncovered Files
${getUncoveredFiles()}

## Recommendations
${getRecommendations(coverage)}
`;
  
  writeFileSync(join(process.cwd(), 'COVERAGE.md'), report);
  console.log('Coverage report generated: COVERAGE.md');
}

function getCoverageStatus(coverage: CoverageSummary): string {
  const metrics = [
    coverage.total.lines.pct,
    coverage.total.statements.pct,
    coverage.total.functions.pct,
    coverage.total.branches.pct
  ];
  
  const minCoverage = Math.min(...metrics);
  
  if (minCoverage >= 95) return '✅ Excellent coverage';
  if (minCoverage >= 80) return '✓ Good coverage';
  if (minCoverage >= 60) return '⚠️ Needs improvement';
  return '❌ Poor coverage';
}

function getUncoveredFiles(): string {
  // Parse lcov.info for uncovered lines
  const lcovPath = join(process.cwd(), 'coverage', 'lcov.info');
  const lcov = readFileSync(lcovPath, 'utf-8');
  
  // Extract files with low coverage
  const files: string[] = [];
  // ... parsing logic
  
  return files.length > 0 
    ? files.map(f => `- ${f}`).join('\n')
    : 'All files meet coverage thresholds';
}

function getRecommendations(coverage: CoverageSummary): string {
  const recommendations: string[] = [];
  
  if (coverage.total.branches.pct < 80) {
    recommendations.push('- Add tests for conditional branches');
  }
  if (coverage.total.functions.pct < 80) {
    recommendations.push('- Test untested functions');
  }
  
  return recommendations.join('\n') || 'Coverage meets all thresholds';
}

// Run if called directly
if (require.main === module) {
  generateCoverageReport();
}
```

## Definition of Done
- [ ] Coverage reports generate successfully
- [ ] HTML report is viewable
- [ ] CI/CD posts coverage to PRs
- [ ] Badge shows current coverage
- [ ] Thresholds block failing builds