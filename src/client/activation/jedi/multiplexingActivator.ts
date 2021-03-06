// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, named } from 'inversify';
import {
    CancellationToken,
    CompletionContext,
    Event,
    EventEmitter,
    Position,
    ReferenceContext,
    SignatureHelpContext,
    TextDocument,
} from 'vscode';
import { ServerCapabilities } from 'vscode-languageserver-protocol';

import { IWorkspaceService } from '../../common/application/types';
import { isTestExecution } from '../../common/constants';
import { JediLSP } from '../../common/experiments/groups';
import { IFileSystem } from '../../common/platform/types';
import {
    BANNER_NAME_PROPOSE_LS,
    IConfigurationService,
    IExperimentService,
    IPythonExtensionBanner,
    Resource,
} from '../../common/types';
import { IServiceManager } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { JediExtensionActivator } from '../jedi';
import { ILanguageServerActivator, ILanguageServerConnection, ILanguageServerManager } from '../types';
import { JediLanguageServerActivator } from './activator';

/**
 * Starts jedi language server manager.
 *
 * @export
 * @class JediLanguageServerActivator
 * @implements {ILanguageServerActivator}
 * @extends {LanguageServerActivatorBase}
 */
@injectable()
export class MultiplexingJediLanguageServerActivator implements ILanguageServerActivator {
    private realLanguageServerPromise: Promise<ILanguageServerActivator>;

    private realLanguageServer: ILanguageServerActivator | undefined;

    private onDidChangeCodeLensesEmitter = new EventEmitter<void>();

    constructor(
        @inject(IServiceManager) private readonly manager: IServiceManager,
        @inject(IExperimentService) experimentService: IExperimentService,
        @inject(IPythonExtensionBanner)
        @named(BANNER_NAME_PROPOSE_LS)
        private proposePylancePopup: IPythonExtensionBanner,
    ) {
        // Check experiment service to see if using new Jedi LSP protocol
        this.realLanguageServerPromise = experimentService.inExperiment(JediLSP.experiment).then((inExperiment) => {
            this.realLanguageServer = !inExperiment
                ? // Pick how to launch jedi based on if in the experiment or not.
                  new JediExtensionActivator(this.manager)
                : new JediLanguageServerActivator(
                      this.manager.get<ILanguageServerManager>(ILanguageServerManager),
                      this.manager.get<IWorkspaceService>(IWorkspaceService),
                      this.manager.get<IFileSystem>(IFileSystem),
                      this.manager.get<IConfigurationService>(IConfigurationService),
                  );
            return this.realLanguageServer;
        });
    }

    public async start(resource: Resource, interpreter: PythonEnvironment | undefined): Promise<void> {
        const realServer = await this.realLanguageServerPromise;
        if (!isTestExecution()) {
            this.proposePylancePopup.showBanner().ignoreErrors();
        }
        return realServer.start(resource, interpreter);
    }

    public activate(): void {
        if (this.realLanguageServer) {
            this.realLanguageServer.activate();
        }
    }

    public deactivate(): void {
        if (this.realLanguageServer) {
            this.realLanguageServer.deactivate();
        }
    }

    public get onDidChangeCodeLenses(): Event<void> {
        return this.onDidChangeCodeLensesEmitter.event;
    }

    public get connection(): ILanguageServerConnection | undefined {
        if (this.realLanguageServer) {
            return this.realLanguageServer.connection;
        }
        return undefined;
    }

    public get capabilities(): ServerCapabilities | undefined {
        if (this.realLanguageServer) {
            return this.realLanguageServer.capabilities;
        }
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideRenameEdits(
        document: TextDocument,
        position: Position,
        newName: string,
        token: CancellationToken,
    ) {
        const server = await this.realLanguageServerPromise;
        return server.provideRenameEdits(document, position, newName, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideDefinition(document: TextDocument, position: Position, token: CancellationToken) {
        const server = await this.realLanguageServerPromise;
        return server.provideDefinition(document, position, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideHover(document: TextDocument, position: Position, token: CancellationToken) {
        const server = await this.realLanguageServerPromise;
        return server.provideHover(document, position, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideReferences(
        document: TextDocument,
        position: Position,
        context: ReferenceContext,
        token: CancellationToken,
    ) {
        const server = await this.realLanguageServerPromise;
        return server.provideReferences(document, position, context, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext,
    ) {
        const server = await this.realLanguageServerPromise;
        return server.provideCompletionItems(document, position, token, context);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideCodeLenses(document: TextDocument, token: CancellationToken) {
        const server = await this.realLanguageServerPromise;
        return server.provideCodeLenses(document, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideDocumentSymbols(document: TextDocument, token: CancellationToken) {
        const server = await this.realLanguageServerPromise;
        return server.provideDocumentSymbols(document, token);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    public async provideSignatureHelp(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: SignatureHelpContext,
    ) {
        const server = await this.realLanguageServerPromise;
        return server.provideSignatureHelp(document, position, token, context);
    }

    public dispose(): void {
        if (this.realLanguageServer) {
            this.realLanguageServer.dispose();
            this.realLanguageServer = undefined;
        }
    }
}
