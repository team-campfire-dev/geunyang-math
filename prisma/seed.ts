// Compatibility command only. Initial content is installed once by a migration.
process.argv.splice(2, process.argv.length - 2, 'verify');
console.warn('db:seed now verifies database content without overwriting it. Use content:import to publish content.');
void import('../scripts/content');
