# Self-test data for the test support library

These files exist only so that `test/support/*.test.ts` can exercise the fixture loader
(`fixtures.ts`) against real files. They are invented for this project: the URLs name a
product that does not exist and the bodies were written by hand.

Fixtures for the packages live under `test/fixtures/`, each in the directory of the package
that owns it.
