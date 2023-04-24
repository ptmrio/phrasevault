# PhraseVault

PhraseVault is a simple and easy-to-use application that allows you to store and manage frequently used phrases or text snippets. With just a few clicks, you can quickly access and paste the stored phrases into any application.

## Why is it open-source?

PhraseVault is open-source by design. The primary reason for this is to ensure maximum security and transparency. As the software may store sensitive information, users can inspect the code, use the provided executable file, or even build the application themselves for increased confidence in the security of the software.

However, even though the code is open-source, a commercial license must be obtained for long-term commercial use. This is to ensure that the software is maintained and improved over time, and to provide a sustainable business model for the developer. Theft of intellectual property is a serious issue and **will lead to bad karma for a lifetime**.

## License

For personal, non-commercial use, the software is free. For commercial use, you will need to purchase a commercial license. Please refer to the [LICENSE](https://github.com/ptmrio/phrasevault/blob/main/LICENSE) file for more details.

### Buy License
PhraseVault is cheap by design. The software is priced to be affordable for everyone, and to provide a sustainable business model for the developer. The software is available in two different license types: per seat, annual payment, and per seat, lifetime. The license is per user, not per device. This means that you can install the software on as many devices as you want, but you will need to purchase a license for each user. The license is non-transferable, so you cannot sell or give away the license to another person.

1. Per Seat, annual payment: https://buy.stripe.com/bIY8yofKxfhx9sQ146
2. Per Seat, Lifetime: https://buy.stripe.com/dR6bKAgOBb1hdJ65kl

### Early Adopter Discount
Use Discount Code `EARLY50` to get 50% off any license, including lifetime. This software will receive regular updates and improvements, so it's a great time to get in on the ground floor.

## Installation

There are two methods to install and use PhraseVault:

### Method 1: Download the ZIP file

1. Download the [ZIP](https://github.com/ptmrio/phrasevault/archive/refs/heads/main.zip) file from the repository.
2. Extract the contents of the ZIP file.
3. Navigate to the `dist` folder and launch `main.exe`.

*Note: Windows SmartScreen may block the application. To bypass this, click on "More Info" and then "Run Anyway" when prompted.*

### Method 2: Build it yourself using PyInstaller (recommended for maximum security)

1. Ensure you have Python and PyInstaller installed on your system.
2. Clone or download the repository.
3. Open a command prompt or terminal window in the repository folder.
4. Run the following command: `pyinstaller --onefile main.py`
5. After the build is complete, navigate to the `dist` folder and launch the `main` executable.

## Usage

Once the application is running, you can add, edit, and manage your phrases using the intuitive interface. To quickly insert a phrase into another application, simply double-click on the desired phrase in the list, or press Enter when it is highlighted. The phrase will be automatically copied to the clipboard and pasted into the active application.

PhraseVault is best stored in a cloud drive for easy access and sharing with other users within a company. Simply copy and rename the `dist` folder to your preferred cloud storage service, such as Google Drive or OneDrive. This way, you can easily share the application with your team, and everyone can benefit from the stored phrases.