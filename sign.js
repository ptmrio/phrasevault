import { execSync } from 'child_process';
import fs from 'fs';

let pin = null;

export default async function(configuration) {
  if (!pin) {
    pin = await promptPin();
  }

  const { path } = configuration;
  console.log(`Signing ${path}`);

  try {
    const certumModule = '"C:\\Program Files\\Certum\\SimplySign Desktop\\proCertum SmartSign\\cryptoCertum3PKCS.dll"';

    // Show token info
    console.log('Token info:');
    execSync(`pkcs11-tool --module ${certumModule} --show-info`, { stdio: 'inherit' });

    // List slots
    console.log('Listing slots:');
    execSync(`pkcs11-tool --module ${certumModule} --list-slots`, { stdio: 'inherit' });

    // List objects
    console.log('Listing objects on the card:');
    execSync(`pkcs11-tool --module ${certumModule} --login --pin "${pin}" --list-objects`, { stdio: 'inherit' });

    // Test PIN
    console.log('Testing PIN:');
    execSync(`pkcs11-tool --module ${certumModule} --login --pin "${pin}" --test`, { stdio: 'inherit' });

    // Generate a hash of the file
    console.log('Generating file hash...');
    execSync(`certutil -hashfile "${path}" SHA256 > "${path}.hash"`, { stdio: 'inherit' });

    // Read the hash
    const hash = fs.readFileSync(`${path}.hash`, 'utf8').split('\n')[1].trim();

    // Sign the hash
    console.log('Signing the hash...');
    const signCommand = `pkcs11-tool --module ${certumModule} --sign --pin "${pin}" --input-file "${path}.hash" --output-file "${path}.sig" --mechanism SHA256-RSA-PKCS`;
    console.log(`Executing command: ${signCommand}`);
    execSync(signCommand, { stdio: 'inherit' });

    // Clean up temporary files
    fs.unlinkSync(`${path}.hash`);

    console.log(`Successfully signed ${path}`);
  } catch (error) {
    console.error(`Failed to sign ${path}: ${error.message}`);
    throw error;
  }
}

async function promptPin() {
  return 94324543;
}