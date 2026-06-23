import fs from 'fs';
import path from 'path';
import { deserializeSCIP } from '@c4312/scip';

async function main() {
  const scipPath = path.resolve(__dirname, '../index.scip');
  if (!fs.existsSync(scipPath)) {
    console.error('index.scip not found at', scipPath);
    return;
  }

  const bytes = fs.readFileSync(scipPath);
  const index = deserializeSCIP(bytes);

  console.log('SCIP metadata:', JSON.stringify(index.metadata));
  console.log('Documents count:', index.documents?.length);

  if (index.documents && index.documents.length > 0) {
    // Find a document that has occurrences
    const docWithOccurrences = index.documents.find(d => d.occurrences && d.occurrences.length > 0);
    if (docWithOccurrences) {
      console.log('Document with occurrences:', docWithOccurrences.relativePath);
      console.log('Occurrences count:', docWithOccurrences.occurrences?.length);
      console.log('Sample Occurrences (first 5):');
      for (let i = 0; i < Math.min(5, docWithOccurrences.occurrences!.length); i++) {
        const occ = docWithOccurrences.occurrences![i];
        console.log(`- Symbol: ${occ.symbol}`);
        console.log(`  Range: ${JSON.stringify(occ.range)}`);
        console.log(`  Roles: ${occ.symbolRoles}`);
      }
    } else {
      console.log('No documents have occurrences.');
    }
  }
}

main().catch(console.error);
