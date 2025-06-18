// Test script to verify argument parsing
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--preview');
const specificMovieTitle = args.find(arg => !arg.startsWith('--'));

console.log('🔧 DEBUG: Command line args:', args);
console.log('🔧 DEBUG: dryRun flag:', dryRun);
console.log('🔧 DEBUG: specificMovieTitle:', specificMovieTitle);

if (dryRun) {
  console.log('✅ DRY RUN MODE DETECTED!');
} else {
  console.log('❌ NOT in dry run mode');
} 