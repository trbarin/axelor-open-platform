/*
 * Axelor Business Solutions
 *
 * Copyright (C) 2005-2022 Axelor (<http://axelor.com>).
 *
 * This program is free software: you can redistribute it and/or  modify
 * it under the terms of the GNU Affero General Public License, version 3,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.axelor.gradle.support;

import com.axelor.gradle.AxelorPlugin;
import com.axelor.gradle.tasks.GenerateCode;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
import org.gradle.api.Project;
import org.gradle.plugins.ide.eclipse.EclipsePlugin;
import org.gradle.plugins.ide.eclipse.EclipseWtpPlugin;
import org.gradle.plugins.ide.eclipse.model.AccessRule;
import org.gradle.plugins.ide.eclipse.model.Classpath;
import org.gradle.plugins.ide.eclipse.model.Container;
import org.gradle.plugins.ide.eclipse.model.EclipseClasspath;
import org.gradle.plugins.ide.eclipse.model.EclipseModel;
import org.gradle.plugins.ide.eclipse.model.Library;
import org.gradle.plugins.ide.eclipse.model.SourceFolder;

public class EclipseSupport extends AbstractSupport {

  @Override
  public void apply(Project project) {
    final EclipseModel eclipse = project.getExtensions().getByType(EclipseModel.class);
    final EclipseClasspath ecp = eclipse.getClasspath();

    project.getPlugins().apply(EclipsePlugin.class);
    project.getPlugins().apply(EclipseWtpPlugin.class);

    project.afterEvaluate(
        p -> {
          if (project.getPlugins().hasPlugin(AxelorPlugin.class)) {
            eclipse.synchronizationTasks(GenerateCode.TASK_NAME);
          }
          if (project.getPlugins().hasPlugin(AxelorPlugin.class)) {
            // Fix wtp issue in included builds (with buildship)
            // see: https://discuss.gradle.org/t/gradle-composite-builds-and-eclipse-wtp/23503
            findIncludedBuildProjects(project).stream()
                .filter(included -> included.getPlugins().hasPlugin(EclipseWtpPlugin.class))
                .forEach(
                    included ->
                        project
                            .getTasks()
                            .getByName("eclipseWtp")
                            .dependsOn(included.getTasks().getByName("eclipseWtp")));
          }
        });

    ecp.setDefaultOutputDir(project.file("bin/main"));
    ecp.getFile()
        .whenMerged(
            (Classpath cp) -> {
              // separate output for main & test sources
              cp.getEntries().stream()
                  .filter(it -> it instanceof SourceFolder)
                  .map(it -> (SourceFolder) it)
                  .filter(
                      it ->
                          it.getPath().startsWith("src/main/") || it.getPath().contains("src-gen/"))
                  .forEach(it -> it.setOutput("bin/main"));

              cp.getEntries().stream()
                  .filter(it -> it instanceof SourceFolder)
                  .map(it -> (SourceFolder) it)
                  .filter(it -> it.getPath().startsWith("src/test/"))
                  .forEach(it -> it.setOutput("bin/test"));

              // remove self-dependency
              cp.getEntries()
                  .removeIf(
                      it ->
                          it instanceof SourceFolder
                              && ((SourceFolder) it).getPath().contains(project.getName()));
              cp.getEntries()
                  .removeIf(
                      it ->
                          it instanceof Library
                              && ((Library) it).getPath().contains(project.getName() + "/build"));

              // add access rule for nashorn api
              cp.getEntries().stream()
                  .filter(it -> it instanceof Container)
                  .map(it -> (Container) it)
                  .filter(it -> it.getPath().contains("org.eclipse.jdt.launching.JRE_CONTAINER"))
                  .forEach(
                      it ->
                          it.getAccessRules()
                              .add(new AccessRule("accessible", "jdk/nashorn/api/**")));
            });

    // finally configure wtp resources
    project.afterEvaluate(
        p -> {
          if (project.getPlugins().hasPlugin(AxelorPlugin.class)) {
            configureWtp(project, eclipse);
          }
        });
  }

  private Map<String, String> resource(String deployPath, String sourcePath) {
    final Map<String, String> map = new HashMap<>();
    map.put("deployPath", deployPath);
    map.put("sourcePath", sourcePath);
    return map;
  }

  private Map<String, String> link(String name, String location) {
    final Map<String, String> map = new HashMap<>();
    map.put("name", name);
    map.put("type", "2");
    map.put("location", location);
    return map;
  }

  private void configureWtp(Project project, EclipseModel eclipse) {
    // try to link axelor-web's webapp dir
    final File dir =
        project.getGradle().getIncludedBuilds().stream()
            .map(it -> new File(it.getProjectDir(), "axelor-web/src/main/webapp"))
            .filter(it -> it.exists())
            .findFirst()
            .orElse(null);

    if (dir != null) {
      eclipse.getProject().linkedResource(link("axelor-webapp", dir.getPath()));
      eclipse.getWtp().getComponent().resource(resource("/", dir.getPath()));
    }

    // finally add build/webapp
    eclipse.getWtp().getComponent().resource(resource("/", "build/webapp"));
  }
}
