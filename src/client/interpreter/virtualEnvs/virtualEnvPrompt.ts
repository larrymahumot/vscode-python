// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, Disposable, Uri } from 'vscode';
import { IExtensionActivationService } from '../../activation/types';
import { IApplicationShell } from '../../common/application/types';
import { inDiscoveryExperiment } from '../../common/experiments/helpers';
import { traceDecorators } from '../../common/logger';
import { IDisposableRegistry, IExperimentService, IPersistentStateFactory } from '../../common/types';
import { sleep } from '../../common/utils/async';
import { Common, Interpreters } from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IPythonPathUpdaterServiceManager } from '../configuration/types';
import {
    IComponentAdapter,
    IInterpreterHelper,
    IInterpreterLocatorService,
    IInterpreterWatcherBuilder,
    WORKSPACE_VIRTUAL_ENV_SERVICE,
} from '../contracts';

const doNotDisplayPromptStateKey = 'MESSAGE_KEY_FOR_VIRTUAL_ENV';
@injectable()
export class VirtualEnvironmentPrompt implements IExtensionActivationService {
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IInterpreterHelper) private readonly helper: IInterpreterHelper,
        @inject(IPythonPathUpdaterServiceManager)
        private readonly pythonPathUpdaterService: IPythonPathUpdaterServiceManager,
        @inject(IDisposableRegistry) private readonly disposableRegistry: Disposable[],
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IComponentAdapter) private readonly pyenvs: IComponentAdapter,
        @inject(IExperimentService) private readonly experimentService: IExperimentService,
    ) {}

    public async activate(resource: Uri): Promise<void> {
        if (await inDiscoveryExperiment(this.experimentService)) {
            const disposable = this.pyenvs.onDidCreate(resource, () => this.handleNewEnvironment(resource));
            this.disposableRegistry.push(disposable);
        } else {
            const builder = this.serviceContainer.get<IInterpreterWatcherBuilder>(IInterpreterWatcherBuilder);
            const watcher = await builder.getWorkspaceVirtualEnvInterpreterWatcher(resource);
            watcher.onDidCreate(
                () => {
                    this.handleNewEnvironment(resource).ignoreErrors();
                },
                this,
                this.disposableRegistry,
            );
        }
    }

    @traceDecorators.error('Error in event handler for detection of new environment')
    protected async handleNewEnvironment(resource: Uri): Promise<void> {
        // Wait for a while, to ensure environment gets created and is accessible (as this is slow on Windows)
        await sleep(1000);
        let interpreters: PythonEnvironment[] | undefined = [];
        if (await inDiscoveryExperiment(this.experimentService)) {
            interpreters = await this.pyenvs.getWorkspaceVirtualEnvInterpreters(resource);
        } else {
            const workspaceVirtualEnvInterpreterLocator = this.serviceContainer.get<IInterpreterLocatorService>(
                IInterpreterLocatorService,
                WORKSPACE_VIRTUAL_ENV_SERVICE,
            );
            interpreters = await workspaceVirtualEnvInterpreterLocator.getInterpreters(resource);
        }
        const interpreter =
            Array.isArray(interpreters) && interpreters.length > 0
                ? this.helper.getBestInterpreter(interpreters)
                : undefined;
        if (!interpreter) {
            return;
        }
        await this.notifyUser(interpreter, resource);
    }

    protected async notifyUser(interpreter: PythonEnvironment, resource: Uri): Promise<void> {
        const notificationPromptEnabled = this.persistentStateFactory.createWorkspacePersistentState(
            doNotDisplayPromptStateKey,
            true,
        );
        if (!notificationPromptEnabled.value) {
            return;
        }
        const prompts = [Common.bannerLabelYes(), Common.bannerLabelNo(), Common.doNotShowAgain()];
        const telemetrySelections: ['Yes', 'No', 'Ignore'] = ['Yes', 'No', 'Ignore'];
        const selection = await this.appShell.showInformationMessage(
            Interpreters.environmentPromptMessage(),
            ...prompts,
        );
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATE_ENVIRONMENT_PROMPT, undefined, {
            selection: selection ? telemetrySelections[prompts.indexOf(selection)] : undefined,
        });
        if (!selection) {
            return;
        }
        if (selection === prompts[0]) {
            await this.pythonPathUpdaterService.updatePythonPath(
                interpreter.path,
                ConfigurationTarget.WorkspaceFolder,
                'ui',
                resource,
            );
        } else if (selection === prompts[2]) {
            await notificationPromptEnabled.updateValue(false);
        }
    }
}
