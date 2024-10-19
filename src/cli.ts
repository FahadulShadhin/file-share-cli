import * as fs from 'fs';
import { intro, outro, text, spinner, select, note } from '@clack/prompts';
import GoogleDriveService from './googleDriveService';
import prompts from 'prompts';
import os from 'os';
import path from 'path';
import DBService from './dbService';
import BCrypt from './bcrypt';
import { generateSharedKey } from './utils';

export default class Cli {
  private googleDriveService: GoogleDriveService;
  private s: ReturnType<typeof spinner>;
  private db: DBService;
  private bcrypt: BCrypt;

  constructor() {
    this.googleDriveService = new GoogleDriveService();
    this.s = spinner();
    this.db = new DBService();
    this.bcrypt = new BCrypt();
  }

  private async askPassword(message: string) {
    const response = await prompts({
      type: 'invisible',
      name: 'passcode',
      message,
      mask: '*',
    });
    return response.passcode;
  }

  private async getFilePathAndPassCode() {
    const filePath = await text({
      message: 'Please enter the file path:',
      validate: (value) => {
        if (!value) return 'File path cannot be empty';
        if (!fs.existsSync(value)) return 'File does not exist';
      },
    });

    const passcode = await this.askPassword('Set a passcode');
    this.s.start('Generating a shared key...');
    const sharedKey = generateSharedKey();
    this.s.stop(`Shared key: ${sharedKey}`);

    return { filePath, passcode, sharedKey };
  }

  private async handleFileUpload() {
    const { filePath, passcode, sharedKey } =
      await this.getFilePathAndPassCode();
    const hashedPassCode = await this.bcrypt.hashPasscode(passcode);

    this.s.start('Processing file...');

    try {
      const file = await this.googleDriveService.uploadFile(filePath as string);
      const fileId = file.id as string;
      const newSecureFile = await this.db.createSecureFile(
        hashedPassCode,
        sharedKey,
        fileId
      );
      this.s.stop(`File successfully uploaded!`);

      note(
        `Share the passcode and shared key to the user who will download the file`,
        'info'
      );
    } catch (error) {
      this.s.stop('File upload failed!');
      console.error('Error uploading file:', error);
    }
  }

  private async handleFileDownload() {
    const sharedKey = await text({
      message: 'Enter the shared key:',
      validate: (value) => {
        if (!value) return 'Must provide the shared key';
      },
    });

    const enteredPasscode = await this.askPassword(
      'Enter your passcode to get download link'
    );

    this.s.start('Varifying passcode...');
    const file = await this.db.getSecureFile(sharedKey as string);

    if (!file) {
      this.s.stop('Wrong shared key!');
      return;
    }

    const validatePassCode = await this.bcrypt.comparePasscode(
      enteredPasscode,
      file?.hashedPassCode
    );

    if (!validatePassCode) {
      this.s.stop('Wrong passcode!');
      return;
    }

    this.s.stop('Success!');
    const fileId = file?.fileId;

    this.s.start('Downloading...');

    try {
      const fileName = await this.googleDriveService.getFileMetadata(fileId);
      if (!fileName) throw new Error('Could not retrieve the file name.');

      const downloadsFolder = path.join(os.homedir(), 'Downloads');
      const destinationPath = path.join(downloadsFolder, fileName);

      await this.googleDriveService.downloadFile(fileId, destinationPath);
      this.s.stop(`File downloaded to: ${destinationPath}`);
    } catch (error) {
      console.error('Error downloading file:', error);
      note('Failed to download file', 'error');
    }
  }

  public async run() {
    intro('Choose an option:');

    const action = (await select({
      message: 'What would you like to do?',
      options: [
        { value: 'upload', label: 'Upload a file' },
        { value: 'download', label: 'Download a file' },
      ],
    })) as 'upload' | 'download';

    const actionMap = {
      upload: this.handleFileUpload.bind(this),
      download: this.handleFileDownload.bind(this),
    };

    await actionMap[action]?.();
    outro(`🫡`);
  }
}
